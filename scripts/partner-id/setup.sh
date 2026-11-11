#!/bin/bash
# Partner IDs + partner payouts: create the tables and grant the Lambdas access.
# Run once in AWS CloudShell (ap-southeast-1) with an admin login.
# Safe to re-run: existing tables/indexes/policies are reported and skipped.
set -u
R=ap-southeast-1
ACCOUNT=$(aws sts get-caller-identity --query Account --output text)
echo "account $ACCOUNT, caller $(aws sts get-caller-identity --query Arn --output text)"

exists() { aws dynamodb describe-table --region $R --table-name "$1" >/dev/null 2>&1; }

create() { # name, then the rest of the create-table arguments
  local name=$1; shift
  if exists "$name"; then echo "skip  table $name (exists)"; return; fi
  aws dynamodb create-table --region $R --table-name "$name" --billing-mode PAY_PER_REQUEST "$@" >/dev/null \
    && echo "ok    table $name" || echo "FAIL  table $name"
}

# 1. Partner accounts: PTN-... rows and EMAIL#<email> guard rows.
create PartnerAccount \
  --attribute-definitions AttributeName=partnerId,AttributeType=S \
  --key-schema AttributeName=partnerId,KeyType=HASH

# 2. Payout tables, keyed by partnerId.
create PartnerWallet \
  --attribute-definitions AttributeName=partnerId,AttributeType=S \
  --key-schema AttributeName=partnerId,KeyType=HASH

create PartnerLedger \
  --attribute-definitions AttributeName=entryId,AttributeType=S AttributeName=partnerId,AttributeType=S AttributeName=createdAt,AttributeType=S \
  --key-schema AttributeName=entryId,KeyType=HASH \
  --global-secondary-indexes '[{"IndexName":"partnerId-createdAt-index","KeySchema":[{"AttributeName":"partnerId","KeyType":"HASH"},{"AttributeName":"createdAt","KeyType":"RANGE"}],"Projection":{"ProjectionType":"ALL"}}]'

create PartnerWithdrawal \
  --attribute-definitions AttributeName=withdrawalId,AttributeType=S AttributeName=status,AttributeType=S AttributeName=createdAt,AttributeType=S AttributeName=partnerId,AttributeType=S \
  --key-schema AttributeName=withdrawalId,KeyType=HASH \
  --global-secondary-indexes '[{"IndexName":"status-createdAt-index","KeySchema":[{"AttributeName":"status","KeyType":"HASH"},{"AttributeName":"createdAt","KeyType":"RANGE"}],"Projection":{"ProjectionType":"ALL"}},{"IndexName":"partnerId-createdAt-index","KeySchema":[{"AttributeName":"partnerId","KeyType":"HASH"},{"AttributeName":"createdAt","KeyType":"RANGE"}],"Projection":{"ProjectionType":"ALL"}}]'

# 3. Index on the existing Partner (key) table: all keys of one partnerId.
if aws dynamodb describe-table --region $R --table-name Partner --query 'Table.GlobalSecondaryIndexes[].IndexName' --output text 2>/dev/null | grep -qw partnerId-index; then
  echo "skip  index Partner/partnerId-index (exists)"
else
  aws dynamodb update-table --region $R --table-name Partner \
    --attribute-definitions AttributeName=partnerId,AttributeType=S \
    --global-secondary-index-updates '[{"Create":{"IndexName":"partnerId-index","KeySchema":[{"AttributeName":"partnerId","KeyType":"HASH"}],"Projection":{"ProjectionType":"ALL"}}}]' >/dev/null \
    && echo "ok    index Partner/partnerId-index (building)" || echo "FAIL  index Partner/partnerId-index"
fi

# 4. Permissions.
T="arn:aws:dynamodb:$R:$ACCOUNT:table"
# arta-api (and createOrder / eSIM Access issuance, which share this role).
cat > /tmp/partner-api-policy.json <<EOF
{
  "Version": "2012-10-17",
  "Statement": [
    {
      "Sid": "PartnerTables",
      "Effect": "Allow",
      "Action": ["dynamodb:GetItem", "dynamodb:PutItem", "dynamodb:UpdateItem", "dynamodb:DeleteItem",
                 "dynamodb:Query", "dynamodb:Scan", "dynamodb:ConditionCheckItem"],
      "Resource": [
        "$T/PartnerAccount", "$T/Partner", "$T/Partner/index/*",
        "$T/PartnerWallet", "$T/PartnerLedger", "$T/PartnerLedger/index/*",
        "$T/PartnerWithdrawal", "$T/PartnerWithdrawal/index/*"
      ]
    },
    {
      "Sid": "PartnerOrders",
      "Effect": "Allow",
      "Action": ["dynamodb:Query"],
      "Resource": ["$T/Order/index/partner-createdAt-index"]
    }
  ]
}
EOF
aws iam put-role-policy --role-name PaymentNotificationMidtransHandler-role-ogd9h4n8 \
  --policy-name partner-id-and-payouts --policy-document file:///tmp/partner-api-policy.json \
  && echo "ok    policy partner-id-and-payouts on PaymentNotificationMidtransHandler-role-ogd9h4n8" \
  || echo "FAIL  policy on PaymentNotificationMidtransHandler-role-ogd9h4n8"

# Montnets issuance: read the key and the account to email the partner.
cat > /tmp/partner-read-policy.json <<EOF
{
  "Version": "2012-10-17",
  "Statement": [
    {
      "Effect": "Allow",
      "Action": ["dynamodb:GetItem"],
      "Resource": ["$T/Partner", "$T/PartnerAccount"]
    }
  ]
}
EOF
aws iam put-role-policy --role-name montnetsEsimIssuance-role \
  --policy-name partner-read --policy-document file:///tmp/partner-read-policy.json \
  && echo "ok    policy partner-read on montnetsEsimIssuance-role" \
  || echo "FAIL  policy on montnetsEsimIssuance-role"

echo
echo "Waiting for tables and the Partner index to become ACTIVE..."
for t in PartnerAccount PartnerWallet PartnerLedger PartnerWithdrawal; do
  aws dynamodb wait table-exists --region $R --table-name $t && echo "ACTIVE $t"
done
for i in $(seq 1 60); do
  s=$(aws dynamodb describe-table --region $R --table-name Partner \
      --query "Table.GlobalSecondaryIndexes[?IndexName=='partnerId-index'].IndexStatus" --output text)
  [ "$s" = "ACTIVE" ] && { echo "ACTIVE Partner/partnerId-index"; break; }
  sleep 10
done
echo "Done. Next: python3 migrate.py (dry run), then python3 migrate.py --apply"
