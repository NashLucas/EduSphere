# Code Coverage & Intentional Gaps

As part of our commitment to maintain high code quality, we mandate a strict >85% test coverage threshold across all business logic services (`src/modules/**/*.service.js`). Integration tests verify the end-to-end functionality of our core models and the API behavior.

However, certain areas of the codebase intentionally fall below this threshold or are completely omitted from coverage to prevent flakiness, avoid hitting third-party limits during CI, or because they represent low-risk boilerplate.

## Intentional Coverage Gaps

### 1. Storage Integration (`src/integrations/storage/s3.js` & `cloudinary.js`)
- **Reason**: We do not want to execute real network requests to AWS S3 or Cloudinary during our automated test suite.
- **Handling**: These modules are mocked during testing (e.g., in unit tests or via Vitest's `vi.mock`). As a result, the internal logic for building S3 commands or interacting with the Cloudinary SDK is not executed, leaving their coverage relatively low.

### 2. Email Transport (`src/integrations/email/index.js` & `templates.js`)
- **Reason**: We prevent our test suite from spamming real email addresses or exhausting our email provider's rate limits.
- **Handling**: The email transport is conditionally mocked or bypassed when `NODE_ENV === 'test'`. The logic that compiles templates and sends the actual emails is not run, leading to lower coverage in these specific files.

### 3. Application Controllers (`src/modules/**/*.controller.js`)
- **Reason**: Controllers in this architecture are designed to be thin wrappers around services. They handle HTTP request/response mapping and pass data down to the deeply tested services.
- **Handling**: While integration tests hit the API endpoints and indirectly cover many controllers, we do not strictly enforce the >85% threshold on controllers. Some error-handling paths and edge-case HTTP responses are safely skipped if the underlying service logic is fully verified.

### 4. Database Setup & Scripts (`src/database/index.js` & `reconcile.js`)
- **Reason**: The database connection wrapper and migration/reconciliation scripts are either executed globally before tests (e.g., `db:seed`) or intended for operational CLI usage.
- **Handling**: They are excluded from strict coverage enforcement.

By maintaining strict coverage on our service layer and intentionally isolating external dependencies, our test suite remains fast, deterministic, and highly reliable.
