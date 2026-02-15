# Service Guide + Migration Checklist

This guide defines the canonical backend layout and migration rules for this repository.

If you are upgrading an external project that was based on an older starter version, use the dedicated checklist in `docs/migration-checklist.md`.

## Canonical Structure

```text
src/server/
  features/
    <feature>/
      <feature>.types.ts
      <feature>.input.ts
      <feature>.schema.ts
      <feature>.router.ts
      <feature>.repository.ts
      <feature>.service.ts
      <module>/
        <module>.types.ts
        <module>.input.ts
        <module>.schema.ts
        <module>.router.ts
        <module>.repository.ts
        <module>.service.ts
  adapters/
    <domain>/
      <adapter>.adapter.ts
      <adapter>/
        <adapter>.adapter.ts
```

## Separation of Concerns

- `.input.ts`: zod input validators and transport parsing.
- `.schema.ts`: persistence schema definitions.
- `.repository.ts`: database access and persistence-only concerns.
- `.service.ts`: business logic orchestration.
- `.router.ts`: tRPC procedures + auth + input wiring.
- `.types.ts`: shared domain contracts across router/service/repository.

## Service and Repository Rules

- First line in services/repositories: `import "server-cli-only";`
- Function input should be a single `params` object.
- Log errors and useful debug output consistently.
- Keep modules colocated with their parent feature.

## Dependency Injection (Enforced)

Dependencies must be constructor-injected with sensible defaults.

### Required patterns

```ts
constructor(
  private readonly repository: FeatureRepository = new FeatureRepository(),
  private readonly logger: Logger = new Logger("FeatureService"),
) {}
```

```ts
constructor(
  private readonly database: typeof db = db,
  private readonly logger: Logger = new Logger("FeatureRepository"),
) {}
```

```ts
constructor(
  private readonly storageAdapter: VercelBlobAdapter = new VercelBlobAdapter(),
) {}
```

### Disallowed patterns

- Constructor params object DI (`constructor(params: {...} = {})`).
- Inline unconditional `new` inside constructor body.
- Logger field initialization (`private readonly logger = new Logger(...)`).
- Direct `db` usage in repositories without constructor injection.

### Lint rules

- `di.constructor.params`
- `di.constructor.inline-new`
- `di.adapter.constructor`
- `di.repository.db`
- `di.logger.constructor`
- `di.logger.field-new`

## Adapter Rules (Enforced)

- Adapters live only under `src/server/adapters`.
- Services import adapters from `@/server/adapters/...`.
- Adapters should be injected via constructors, not instantiated ad hoc in methods.

### Lint rules

- `adapter.location`
- `adapter.folder.file`
- `di.adapter.constructor`

## Nested Modules

- Nested service classes are instantiated by their parent service.
- Nested service instances are exposed as public properties on parent service.
- Router nesting mirrors service nesting (`featureRouter.module = moduleRouter`).

## Migration Checklist

Use this checklist when migrating legacy code to the current architecture.

### 1) Move to canonical folders

- [ ] Move services from legacy roots to `src/server/features/<feature>/...`.
- [ ] Move adapters to `src/server/adapters/<domain>/...`.
- [ ] Keep module-level files colocated under their module folder.

### 2) Rename and import cleanup

- [ ] Replace old path imports with `@/server/features/...`.
- [ ] Replace adapter imports with `@/server/adapters/...`.
- [ ] Rename legacy symbols to current names (example: `blob*` → `storage*`, `audio-recordings` → `audio`).
- [ ] Ensure exported service singleton names match class intent (`storageService`, `audioService`, etc.).

### 3) Apply DI requirements

- [ ] Inject repository, adapters, logger in constructor parameters with defaults.
- [ ] Inject `db` in every repository that uses database calls.
- [ ] Remove constructor params-object DI.
- [ ] Remove inline constructor-body `new` patterns.
- [ ] Remove logger class-field `new Logger(...)` initialization.

### 4) Router and input conformance

- [ ] Ensure each mutation/query uses explicit `.input(...)` where applicable.
- [ ] Ensure routers call services instead of directly touching adapters/db.
- [ ] Keep procedure auth level explicit (`public`, `protected`, org-protected).

### 5) Verify with lint

- [ ] Run `bun service lint --strict`.
- [ ] Resolve all rule violations, especially DI and adapter location rules.
- [ ] Re-run strict lint until it passes with zero issues.

## Quick Example (Compliant Service)

```ts
import "server-cli-only";

import Logger from "@/lib/logger";
import FeatureRepository from "./feature.repository";
import ChildService from "./child/child.service";

class FeatureService {
  constructor(
    private readonly repository: FeatureRepository = new FeatureRepository(),
    private readonly logger: Logger = new Logger("FeatureService"),
    public readonly child: ChildService = new ChildService(),
  ) {}

  public async create(params: { name: string }) {
    const result = await this.repository.create(params);
    this.logger.debug(`create(...) -> ok`);
    return result;
  }
}

export const featureService = new FeatureService();
```
