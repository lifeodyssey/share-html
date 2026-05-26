# Cloudflare Workers Builds Deployment

Share HTML uses GitHub Actions as the release gate and Cloudflare Workers Builds as the production deploy runner.

The desired flow is:

1. A pull request runs GitHub CI.
2. After the PR is merged, the `main` push runs GitHub CI again.
3. If GitHub CI passes, GitHub Actions sends a `POST` to a Cloudflare Workers Builds Deploy Hook.
4. Cloudflare builds the connected repo and deploys the `share-html` Worker.

This avoids storing a broad Cloudflare API token in GitHub.

## GitHub Actions

The workflow is [`../../.github/workflows/ci.yml`](../../.github/workflows/ci.yml).

It runs:

```bash
npm ci
npm run build
npx wrangler deploy --dry-run
```

On `main`, after those checks pass, it calls:

```bash
curl --fail --show-error --request POST "$CLOUDFLARE_WORKERS_DEPLOY_HOOK_URL"
```

The hook URL must be stored as a GitHub repository secret:

```bash
gh secret set CLOUDFLARE_WORKERS_DEPLOY_HOOK_URL -R lifeodyssey/share-html --body '<deploy-hook-url>'
```

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

6. Create a Deploy Hook:

```text
Name: github-ci-main
Branch: main
```

7. Copy the generated URL into the GitHub secret `CLOUDFLARE_WORKERS_DEPLOY_HOOK_URL`.

Important: do not leave a separate automatic Cloudflare production deploy active for every `main` push if the intent is strict GitHub CI gating. The deployment should be triggered by the GitHub workflow after CI passes.

## How CI And Cloudflare Are Connected

Cloudflare Workers Builds does not wait for GitHub Actions by itself. A normal Workers Builds Git integration starts from the Git push event.

The connection is the Deploy Hook:

- GitHub CI is the gate.
- The Deploy Hook is the handoff.
- Cloudflare Workers Builds is the deploy runner.

If the GitHub build fails, the hook is never called and Cloudflare never starts the production deploy.

## Manual Deploy

Local deploys still work for emergency use:

```bash
npm run deploy
```
