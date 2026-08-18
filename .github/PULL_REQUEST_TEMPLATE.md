# Pull Request

## Description
Provide a brief description of the changes introduced by this PR. Include the motivation and context.

## Type of Change
- [ ] Bug fix (non-breaking change which fixes an issue)
- [ ] New feature (non-breaking change which adds functionality)
- [ ] Breaking change (fix or feature that would cause existing functionality to not work as expected)
- [ ] Documentation update
- [ ] Chore (tooling, dependencies, refactoring)

## Code Review Checklist
Before merging, please ensure this PR satisfies the following criteria:

- [ ] Route middleware adheres to: `validate(schema) -> requireAuth -> requireRole -> controller`.
- [ ] Controllers delegate to services; no direct `req`/`res` manipulation inside services.
- [ ] Quiz questions strip `correctAnswerIndex` on student-facing routes.
- [ ] Database changes include Prisma migrations and proper index coverage.
- [ ] Side effects (emails, badges, notifications) are non-blocking.
- [ ] User-facing strings originate from `system_messages.js`.
- [ ] Automated unit and integration tests pass cleanly with sufficient coverage (`npm run test:run` and `npm run lint`).

## Verification Steps
Describe the steps to verify your changes:
1. 
2. 
3. 

## Related Issues
Closes #<issue_number>
