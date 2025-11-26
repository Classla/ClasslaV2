# DynamoDB Clarification

## The Confusion

You noticed DynamoDB mentioned in the infrastructure documentation and were concerned because your application uses Supabase (PostgreSQL), not DynamoDB.

**Good news**: You're absolutely right to be concerned, but there's no issue here.

## The Truth

**DynamoDB is ONLY used for Terraform state locking. It is NOT used by your application.**

## What is Terraform State Locking?

When multiple people (or CI/CD pipelines) try to run Terraform at the same time, they could corrupt the infrastructure state. To prevent this, Terraform uses a "lock" mechanism.

### How It Works

```
Developer 1: terraform apply
    ↓
Terraform: "Let me check if anyone else is running..."
    ↓
DynamoDB: "Nope, you're good. I'll lock it for you."
    ↓
Terraform: *makes infrastructure changes*
    ↓
DynamoDB: "Done? OK, unlocking."

Developer 2: terraform apply (while Dev 1 is running)
    ↓
Terraform: "Let me check if anyone else is running..."
    ↓
DynamoDB: "Yes! Dev 1 is running. Please wait."
    ↓
Terraform: "Error: state is locked by another process"
```

### Why DynamoDB?

- **Fast**: Sub-millisecond reads/writes
- **Reliable**: 99.99% availability
- **Cheap**: Pay-per-request, costs ~$0.10/month
- **Standard**: AWS best practice for Terraform state locking

## Your Application Architecture

```
┌─────────────────────────────────────────────────────┐
│                  YOUR APPLICATION                   │
│                                                     │
│  Frontend (Amplify)                                 │
│       ↓                                             │
│  Backend (ECS Fargate)                              │
│       ↓                                             │
│  Supabase (PostgreSQL) ← YOUR DATABASE             │
│                                                     │
│  NO DYNAMODB USED HERE                              │
└─────────────────────────────────────────────────────┘

┌─────────────────────────────────────────────────────┐
│              TERRAFORM INFRASTRUCTURE               │
│                                                     │
│  terraform apply                                    │
│       ↓                                             │
│  S3 (stores state file)                             │
│  DynamoDB (locks state file) ← ONLY USED HERE      │
│                                                     │
│  COMPLETELY SEPARATE FROM YOUR APP                  │
└─────────────────────────────────────────────────────┘
```

## Where DynamoDB is Mentioned

### 1. `infrastructure/terraform/backend.tf`

```hcl
terraform {
  backend "s3" {
    bucket         = "classla-terraform-state"
    key            = "infrastructure/terraform.tfstate"
    region         = "us-east-1"
    encrypt        = true
    dynamodb_table = "classla-terraform-locks"  ← HERE
  }
}
```

**Purpose**: Tell Terraform to use DynamoDB for locking

### 2. `infrastructure/scripts/init-terraform.sh`

```bash
# Create DynamoDB table for state locking
aws dynamodb create-table \
  --table-name classla-terraform-locks \
  ...
```

**Purpose**: Create the DynamoDB table that Terraform will use for locking

### 3. `infrastructure/docs/SETUP.md`

```markdown
- Create and manage DynamoDB tables
```

**Purpose**: IAM permissions needed to create the lock table

### 4. `infrastructure/docs/DEPLOYMENT.md`

```markdown
The Terraform backend stores infrastructure state in S3 with DynamoDB for state locking.
```

**Purpose**: Explain how Terraform state management works

## What Your Application Actually Uses

### Database: Supabase (PostgreSQL)

```typescript
// classla-backend/src/db.ts (or similar)
import { createClient } from "@supabase/supabase-js";

const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY
);

// All your data is in PostgreSQL
const { data, error } = await supabase.from("users").select("*");
```

### Authentication: WorkOS

```typescript
// classla-backend/src/auth.ts (or similar)
import { WorkOS } from "@workos-inc/node";

const workos = new WorkOS(process.env.WORKOS_API_KEY);
```

### File Storage: S3

```typescript
// classla-backend/src/storage.ts (or similar)
import { S3Client } from "@aws-sdk/client-s3";

const s3 = new S3Client({ region: "us-east-1" });
```

### Session Storage: Redis (if configured)

```typescript
// classla-backend/src/session.ts (or similar)
import RedisStore from "connect-redis";
import { createClient } from "redis";

const redisClient = createClient();
```

## Verification

### Check Your Backend Code

```bash
# Search for DynamoDB usage in your backend
cd classla-backend
grep -r "dynamodb\|DynamoDB" src/

# Should return: No matches found
```

### Check Your Dependencies

```bash
# Look at package.json
cat classla-backend/package.json | grep -i dynamo

# Should return: Nothing
```

Your `package.json` shows:

```json
{
  "dependencies": {
    "@supabase/supabase-js": "^2.38.0",  ← PostgreSQL
    "@workos-inc/node": "^7.70.0",       ← Auth
    "@aws-sdk/client-s3": "^3.913.0",    ← File storage
    // NO DynamoDB SDK
  }
}
```

## Cost Impact

### DynamoDB for Terraform State Locking

- **Reads**: ~10 per Terraform run
- **Writes**: ~2 per Terraform run
- **Cost**: $0.25 per million requests
- **Your cost**: ~$0.10/month (assuming 100 Terraform runs)

### If You Were Using DynamoDB for Your App

- **Typical cost**: $25-100+/month depending on usage
- **But you're not**, so you save this money

## Summary

| Component            | What It Uses          | Purpose                           |
| -------------------- | --------------------- | --------------------------------- |
| **Your Application** | Supabase (PostgreSQL) | Store all application data        |
| **Terraform**        | DynamoDB              | Prevent concurrent Terraform runs |

**Bottom line**: DynamoDB is infrastructure tooling, not application data storage. Your app correctly uses Supabase.

## Should You Remove DynamoDB?

**No!** You need it for Terraform state locking.

Without it:

- Multiple developers could run Terraform simultaneously
- Infrastructure state could become corrupted
- You'd have to manually coordinate Terraform runs

**Keep it.** It costs $0.10/month and prevents major headaches.

## Alternative: Terraform Cloud

If you really don't want to manage DynamoDB, you could use Terraform Cloud:

```hcl
terraform {
  cloud {
    organization = "your-org"
    workspaces {
      name = "classla-production"
    }
  }
}
```

**Pros**:

- No S3 or DynamoDB to manage
- Built-in state locking
- Free for small teams

**Cons**:

- State stored outside your AWS account
- Requires Terraform Cloud account
- Less control

**Recommendation**: Stick with S3 + DynamoDB. It's the standard approach.

## Questions?

**Q: Will DynamoDB affect my application performance?**  
A: No. Your application never touches it.

**Q: Can I delete the DynamoDB table?**  
A: Only if you stop using Terraform. Not recommended.

**Q: Why didn't the AI mention this was for Terraform only?**  
A: The documentation assumes you know Terraform basics. It's a fair assumption, but easy to miss.

**Q: Is there any other "hidden" AWS service I should know about?**  
A: Check `INFRASTRUCTURE_REVIEW.md` for the complete list of services used.

## Related Documentation

- **Full infrastructure review**: `INFRASTRUCTURE_REVIEW.md`
- **Deployment guide**: `DEPLOYMENT.md`
- **Quick start**: `../QUICK_START.md`
