# StockPing

A serverless "notify me when it's back in stock" service on AWS — Cognito auth,
an HTTP API backed by Lambda, a single-table DynamoDB design, and a scheduled
Lambda that emails watchers via SES when a product restocks. Built as a 5-day
hands-on AWS practice project; see [`ROADMAP.md`](./ROADMAP.md) for the build
log and [`ARCHITECTURE.md`](./ARCHITECTURE.md) for the full design write-up.

## Architecture

```
                         ┌─────────────────────┐
   Cognito User Pool ───▶│  JWT (id/access tok) │
   (sign-up/sign-in)     └──────────┬───────────┘
                                    │ Authorization: Bearer <jwt>
                                    ▼
                    ┌───────────────────────────────┐
                    │   API Gateway (HTTP API)       │
                    │   + Cognito JWT authorizer     │
                    └───────────────┬────────────────┘
                POST /watches   GET /watches   DELETE /watches/{id}
                                    │
                                    ▼
                    ┌───────────────────────────────┐
                    │   Lambda: createWatch /        │
                    │   listWatches / deleteWatch     │
                    └───────────────┬────────────────┘
                                    ▼
                    ┌───────────────────────────────┐
                    │   DynamoDB (single-table)       │
                    │   PK=USER#id  SK=WATCH#prodId   │
                    │   GSI1: PRODUCT#id → USER#id     │
                    └───────────────▲────────────────┘
                                    │ query GSI1 (who's watching X)
                    ┌───────────────┴────────────────┐
                    │  Lambda: checkStockAndNotify     │
                    │  triggered by EventBridge         │
                    │  (rate(15 min))                   │
                    └───────────────┬────────────────┘
                                    │ GET /products (stock levels)
                                    ▼
                    ┌───────────────────────────────┐
                    │  Express "legacy" service        │
                    │  GET /products                    │
                    │  PATCH /products/:id/stock        │
                    │  (simulates an existing warehouse │
                    │   system) — local + ngrok          │
                    └───────────────────────────────┘
                                    │
                                    ▼ (product goes stock > 0)
                              SES sandbox → email to watchers
```

Every Lambda execution role is scoped to the exact DynamoDB actions, table/index
ARNs, and log group it needs — no `dynamodb:*`, no account-wide CloudWatch Logs
wildcard. See [`ARCHITECTURE.md`](./ARCHITECTURE.md#design-decisions) for the
reasoning behind these choices.

## Tech stack

| Layer | Choice |
|---|---|
| IaC | AWS CDK v2 (TypeScript) |
| Compute | AWS Lambda (Node.js 20) |
| Auth | Amazon Cognito (User Pool + JWT authorizer) |
| API | API Gateway HTTP API |
| Data | DynamoDB (single table + 1 GSI) |
| Scheduling | EventBridge (`rate(15 minutes)`) |
| Email | Amazon SES (sandbox) |
| "Legacy" backend | Express (local, tunneled via ngrok) |
| Validation | Zod |
| Tests | Jest (unit) + `aws-sdk-client-mock` |

## Repo layout

```
infra/            CDK app — DataStack, AuthStack, ApiStack, SchedulerStack
lambdas/          createWatch, listWatches, deleteWatch, checkStockAndNotify
legacy-express/   stand-in "warehouse" service: GET/PATCH /products
```

All three are a pnpm workspace (`pnpm-workspace.yaml`).

## Prerequisites

- Node.js 20+, [pnpm](https://pnpm.io/)
- An AWS account with credentials configured (`aws configure` / an AWS CLI profile) and permission to create the resources above
- [AWS CDK](https://docs.aws.amazon.com/cdk/v2/guide/getting-started.html) — installed as a dev dependency in `infra/`, invoked via `npx cdk`
- [ngrok](https://ngrok.com/) (free tier) — only needed to expose `legacy-express` for `checkStockAndNotify` to reach
- An email address you can verify in SES (sandbox mode only sends to/from verified identities)

## Setup

```bash
git clone <this-repo>
cd StockPing
pnpm install
```

## Deploy

The stacks have a dependency order — `DataStack` and `AuthStack` first, then
`ApiStack`, then `SchedulerStack` last (it needs `LEGACY_API_URL` and
`SES_FROM_EMAIL`, which aren't known until the pieces above exist). Run
everything from `infra/`:

```bash
cd infra

# One-time per AWS account/region
npx cdk bootstrap

# Core stacks — no extra env vars needed
npx cdk deploy DataStack AuthStack ApiStack
```

Note the `ApiStack` output (`HttpApiUrl`) and the `AuthStack` outputs
(`UserPoolId`, `UserPoolClientId`) printed at the end of the deploy — you'll
need them below.

### Bring up the legacy service + tunnel

```bash
# terminal 1
cd legacy-express
pnpm dev                 # listens on :3000

# terminal 2
ngrok http 3000          # copy the https://*.ngrok-free.app URL it prints
```

> ngrok's free tier assigns a new random URL every time the tunnel restarts.
> If you restart it after `SchedulerStack` is deployed, re-run the
> `SchedulerStack` deploy below with the new URL (or
> `aws lambda update-function-configuration` for a quicker one-off fix).

### Verify an SES sender identity

SES sandbox mode requires the `From` address to be verified:

```bash
aws ses verify-email-identity --email-address you@example.com
```

Check that inbox and click the confirmation link before deploying
`SchedulerStack`. In sandbox mode, notification emails can also be sent only
to other verified addresses — verify your recipient too if it differs.

### Deploy the scheduler stack

```bash
# still in infra/
export LEGACY_API_URL=https://<your-ngrok-subdomain>.ngrok-free.app
export SES_FROM_EMAIL=you@example.com

npx cdk deploy SchedulerStack
```

(`SchedulerStack` isn't synthesized at all unless both env vars are set — see
`infra/bin/infra.ts`.)

## Try it end-to-end

Using the `UserPoolId`/`UserPoolClientId` from the `AuthStack` output and the
`HttpApiUrl` from `ApiStack`:

```bash
# 1. Create + confirm a user (no email verification step needed for CLI testing)
aws cognito-idp sign-up \
  --client-id <UserPoolClientId> \
  --username you@example.com --password 'YourPass123!' \
  --user-attributes Name=email,Value=you@example.com

aws cognito-idp admin-confirm-sign-up \
  --user-pool-id <UserPoolId> --username you@example.com

# 2. Get a JWT
aws cognito-idp initiate-auth \
  --client-id <UserPoolClientId> \
  --auth-flow USER_PASSWORD_AUTH \
  --auth-parameters USERNAME=you@example.com,PASSWORD='YourPass123!'
# → copy AuthenticationResult.IdToken

# 3. Watch a product
curl -X POST "<HttpApiUrl>/watches" \
  -H "Authorization: Bearer <IdToken>" \
  -H "Content-Type: application/json" \
  -d '{"productId":"1"}'

# 4. Trigger a restock on the legacy service
curl -X PATCH http://localhost:3000/products/1/stock \
  -H "Content-Type: application/json" -d '{"stock": 5}'

# 5. Either wait up to 15 minutes for the EventBridge rule, or invoke it now
#    (function name is auto-suffixed by CDK — find it once, then reuse it):
aws lambda list-functions --query "Functions[?contains(FunctionName,'CheckStockAndNotifyFn')].FunctionName" --output text
aws lambda invoke --function-name <name-from-above> /dev/stdout
```

You should get an email at the watching address shortly after step 5 — check
spam first, since a freshly-verified personal SES identity has no sending
reputation yet.

## Testing

Each workspace has its own Jest suite (CDK template assertions in `infra/`,
handler unit tests with mocked AWS SDK clients in `lambdas/`, supertest
integration tests in `legacy-express/`):

```bash
pnpm --filter infra test
pnpm --filter lambdas test
pnpm --filter legacy-express test
```

`infra/test/auth-flow.integration.test.ts` hits a *deployed* `AuthStack` and
is skipped by default — opt in with:

```bash
RUN_AWS_INTEGRATION_TESTS=1 pnpm --filter infra exec jest auth-flow.integration --no-coverage
```

## Cleanup

Every stack has `RemovalPolicy.DESTROY` set so nothing is left orphaned:

```bash
cd infra
npx cdk destroy SchedulerStack ApiStack AuthStack DataStack
```

Also stop the local `legacy-express`/`ngrok` processes.

## License

[MIT](./LICENSE)
