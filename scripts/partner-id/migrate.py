#!/usr/bin/env python3
"""
Give every existing affiliate partner a permanent partnerId.

Reads the Partner table (one row per affiliate key), groups the keys by login
email (trimmed, lowercased), and for each email:
  - creates a PartnerAccount row  PTN-XXXXXXXX  (email, createdAt = oldest key)
  - creates the guard row         EMAIL#<email> -> ownerPartnerId
  - sets partnerId on each of that email's key rows

Dry run by default; pass --apply to write. Safe to re-run: an email that
already has an account keeps its partnerId, and rows that already carry a
partnerId are never changed. Writes partner-ids.csv (partnerId, email, keys).

Run in AWS CloudShell after setup.sh:  python3 migrate.py  /  python3 migrate.py --apply
"""
import csv
import secrets
import sys
from collections import defaultdict
from datetime import datetime, timezone

import boto3
from boto3.dynamodb.conditions import Attr
from botocore.exceptions import ClientError

REGION = "ap-southeast-1"
ALPHABET = "0123456789ABCDEFGHJKMNPQRSTVWXYZ"  # Crockford base32, same as the API

apply = "--apply" in sys.argv
db = boto3.resource("dynamodb", region_name=REGION)
keys_table = db.Table("Partner")
accounts = db.Table("PartnerAccount")
now = datetime.now(timezone.utc).strftime("%Y-%m-%dT%H:%M:%S.%f")[:-3] + "Z"


def new_partner_id():
    return "PTN-" + "".join(ALPHABET[b % 32] for b in secrets.token_bytes(8))


def scan(table):
    items, kwargs = [], {}
    while True:
        page = table.scan(**kwargs)
        items += page.get("Items", [])
        if "LastEvaluatedKey" not in page:
            return items
        kwargs["ExclusiveStartKey"] = page["LastEvaluatedKey"]


rows = scan(keys_table)
groups, skipped = defaultdict(list), []
for row in rows:
    email = str(row.get("email") or "").strip().lower()
    if email:
        groups[email].append(row)
    else:
        skipped.append(row)

print(f"{'APPLY' if apply else 'DRY RUN'}: {len(rows)} keys, {len(groups)} emails"
      f"{f', {len(skipped)} keys without email (skipped)' if skipped else ''}\n")

stats = defaultdict(int)
mapping, problems = [], []

for email in sorted(groups):
    group = sorted(groups[email], key=lambda r: (str(r.get("createdAt") or ""), r["key"]))
    keys = [r["key"] for r in group]
    guard = accounts.get_item(Key={"partnerId": f"EMAIL#{email}"}).get("Item")
    row_ids = {r["partnerId"] for r in group if r.get("partnerId")}
    owner = guard.get("ownerPartnerId") if guard else None

    if len(row_ids | ({owner} if owner else set())) > 1:
        problems.append(f"{email}: keys already belong to different partnerIds {sorted(row_ids | {owner})} - left as is")
        continue

    partner_id = owner or (next(iter(row_ids)) if row_ids else new_partner_id())
    mapping.append((partner_id, email, " ".join(keys)))
    created_at = next((str(r["createdAt"]) for r in group if r.get("createdAt")), now)
    todo = [r for r in group if not r.get("partnerId")]
    has_account = bool(accounts.get_item(Key={"partnerId": partner_id}).get("Item"))

    label = f"{partner_id}  {email}  [{', '.join(keys)}]"
    if has_account and guard and not todo:
        stats["already done"] += 1
        continue
    print(("+ " if not has_account else "~ ") + label)

    if not apply:
        stats["would create account" if not has_account else "would complete"] += 1
        continue

    try:
        if not has_account:
            accounts.put_item(
                Item={"partnerId": partner_id, "email": email, "createdAt": created_at, "updatedAt": now,
                      "migratedAt": now},
                ConditionExpression=Attr("partnerId").not_exists())
            stats["accounts created"] += 1
        if not guard:
            accounts.put_item(
                Item={"partnerId": f"EMAIL#{email}", "ownerPartnerId": partner_id, "email": email, "createdAt": now},
                ConditionExpression=Attr("partnerId").not_exists())
        for r in todo:
            keys_table.update_item(
                Key={"key": r["key"]},
                UpdateExpression="SET partnerId = :p",
                ConditionExpression=Attr("partnerId").not_exists() | Attr("partnerId").eq(partner_id),
                ExpressionAttributeValues={":p": partner_id})
            stats["keys linked"] += 1
    except ClientError as error:
        problems.append(f"{email}: {error.response['Error']['Code']} - rerun to finish")

with open("partner-ids.csv", "w", newline="") as f:
    writer = csv.writer(f)
    writer.writerow(["partnerId", "email", "keys"])
    writer.writerows(sorted(mapping, key=lambda m: m[1]))

print()
for k, v in sorted(stats.items()):
    print(f"{k}: {v}")
multi = [m for m in mapping if " " in m[2]]
print(f"emails with more than one key: {len(multi)}")
for m in multi:
    print(f"  {m[0]}  {m[1]}  [{m[2]}]")
for r in skipped:
    print(f"skipped key without email: {r['key']}")
for p in problems:
    print(f"PROBLEM {p}")
print(f"\nwrote partner-ids.csv ({len(mapping)} partners)")
if not apply:
    print("dry run only - nothing written. New partnerIds in this CSV are examples;")
    print("the real ones are chosen when you run again with --apply.")
