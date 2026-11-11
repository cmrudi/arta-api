#!/usr/bin/env python3
"""
One-off cleanup: delete the EMAIL#<email> rows from PartnerAccount.

The first version of partner IDs kept one "EMAIL#<email>" row per partner to
make login emails unique. The API now finds accounts through the email-index
instead, so those rows are no longer used. Only rows whose partnerId starts
with EMAIL# and that carry ownerPartnerId are deleted; PTN-... accounts are
never touched.

Dry run by default; pass --apply to delete. Safe to re-run.
"""
import sys

import boto3
from boto3.dynamodb.conditions import Attr

apply = "--apply" in sys.argv
table = boto3.resource("dynamodb", region_name="ap-southeast-1").Table("PartnerAccount")

items, kwargs = [], {"FilterExpression": Attr("partnerId").begins_with("EMAIL#")}
while True:
    page = table.scan(**kwargs)
    items += page.get("Items", [])
    if "LastEvaluatedKey" not in page:
        break
    kwargs["ExclusiveStartKey"] = page["LastEvaluatedKey"]

rows = [i for i in items if i.get("ownerPartnerId")]
print(f"{'APPLY' if apply else 'DRY RUN'}: {len(rows)} EMAIL# rows to delete")

deleted = 0
if apply:
    for row in rows:
        table.delete_item(
            Key={"partnerId": row["partnerId"]},
            ConditionExpression=Attr("partnerId").begins_with("EMAIL#") & Attr("ownerPartnerId").exists())
        deleted += 1
    print(f"deleted {deleted}")
else:
    for row in rows[:5]:
        print(f"  would delete {row['partnerId']} -> {row['ownerPartnerId']}")
    print("dry run only - nothing deleted. Run again with --apply.")

accounts = table.scan(Select="COUNT", FilterExpression=Attr("partnerId").begins_with("PTN-"))["Count"]
print(f"PTN- accounts in the table: {accounts} (unchanged)")
