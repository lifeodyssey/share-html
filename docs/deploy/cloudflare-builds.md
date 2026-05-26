# Cloudflare Workers Builds Deployment

Share HTML uses GitHub branch protection as the release gate and Cloudflare Workers Builds as the production deploy runner.

The desired flow is:

1. A pull request runs GitHub CI.
2. GitHub branch protection requires the `Build` check to pass before code can land on `main`.
3. After the PR is merged, Cloudflare Workers Builds sees the `main` push, builds that branch, and deploys the `share-html` Worker.

This avoids storing a Cloudflare API token or deploy hook URL in GitHub.

## GitHub Actions

The workflow is [`../../.github/workflows/ci.yml`](../../.github/workflows/ci.yml).

It runs:

```bash
npm ci
npm run build
npx wrangler deploy --dry-run
```

The workflow uses GitHub's built-in `GITHUB_TOKEN` with read-only repository access; no Cloudflare secret is required.

## GitHub Branch Protection

Protect the `main` branch with a required status check:

```text
Branch: main
Required check: Build
Require branches to be up to date before merging: enabled
Apply protection to administrators: enabled
Allow force pushes: disabled
Allow deletions: disabled
```

This makes `main` the release boundary. Cloudflare can listen to `main` because a commit should only arrive there after GitHub has accepted the required CI check.

## Cloudflare Setup

In Cloudflare Dashboard:

1. Open `Workers & Pages`.
2. Select the existing Worker `share-html`.
3. Open `Settings -> Builds`.
4. Connect the GitHub repository `lifeodyssey/share-html`.
5. Use these build settings:

```text
Production branch: main
Root directory: /
Build command: npm run build
Deploy command: npx wrangler deploy
```

6. Disable builds for non-production branches unless preview builds are intentionally needed.

## How CI And Cloudflare Are Connected

Cloudflare Workers Builds does not wait for GitHub Actions by itself. A normal Workers Builds Git integration starts from the Git push event.

The connection is GitHub branch protection:

- GitHub CI provides the required `Build` status check.
- Branch protection prevents unchecked commits from landing on `main`.
- Cloudflare Workers Builds is the deploy runner.

If the GitHub build fails, the PR cannot merge into `main`, so Cloudflare never sees a production deploy event for that change.

## Manual Deploy

Local deploys still work for emergency use:

```bash
npm run deploy
```
