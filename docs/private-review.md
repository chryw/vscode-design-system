# Private review deployment

## Private repository snapshots

Personal EMU repositories can hold review snapshots but cannot host Pages websites. The repository-only publisher uploads the complete interactive book, a book-source archive, and revision metadata as a private GitHub release. It downloads and checks every asset before making the release available. It doesn't create unsigned code commits or change the active CLI login.

```sh
node .github/extensions/vscode-design-system/scripts/publish.mjs \
  --repository github.com/cherwan_microsoft/vscode-design-system \
  --account cherwan_microsoft \
  --repository-only --watch
```

Share the repository's **Releases → Latest** address with people who have repository access. Readers download `design-system.html` and open it in a current browser; GitHub doesn't execute HTML attachments. Feedback and patch contributions go through Issues, using the topic ID or chapter address. The source archive includes book content and tools, not a second fork of product code.

The watcher rebuilds when book files, selected product working changes, or the checkout commit change. It checks every 30 seconds and waits for edits to settle. Updating VS Code in the author's checkout triggers a new snapshot; this doesn't fetch or merge upstream automatically. Failed uploads remain drafts. A source race discards the export and reports it; the watcher retries after edits settle.

Omit `--watch` for one publication, or use `--check` for a read-only authentication and repository-privacy check. Run the watcher through the host's supported persistent execution mechanism when it must outlive the client; the command doesn't install an OS service.

## Access-controlled Pages

Publish the portable book to an access-controlled GitHub Pages project. Enterprise Managed Users must use an organization-owned repository; a personal repository isn't eligible. The publisher refuses public Pages sites.

The deployed book includes all chapters and mapped interactive product fixtures. Readers need repository read access. Issues collect chapter-linked feedback and proposed patches; the owning files remain in the VS Code checkout rather than becoming a second independently maintained book.

## Prepare the enterprise repository

Use the correct host and existing EMU login; for this account, that's `github.com` and `cherwan_microsoft`. Create a private repository in an approved enterprise organization, initialize it with a README, enable Issues, and set its default branch to `main`. Clone it into a dedicated directory, configure the verified Git identity and signing key there, and keep commit signing enabled. Don't reuse or modify the VS Code worktree's origin.

In repository **Settings → Pages**, choose **GitHub Actions** and confirm that the website is private. Give reviewers read access to the repository and contributors the appropriate additional access. This guide doesn't assume an organization or grant access to unspecified people.

Run the publisher's read-only preflight:

```sh
node .github/extensions/vscode-design-system/scripts/publish.mjs \
  --repository github.com/ORGANIZATION/vscode-design-system \
  --account cherwan_microsoft \
  --check
```

## Publish and keep updating

```sh
node .github/extensions/vscode-design-system/scripts/publish.mjs \
  --repository github.com/ORGANIZATION/vscode-design-system \
  --account cherwan_microsoft \
  --checkout /absolute/path/to/private-review-clone \
  --watch
```

Omit `--watch` for one publication. The process exports a complete snapshot, signs and pushes it to the dedicated review repository, and verifies the remote head and GitHub signature. GitHub Actions deploys the generated files; CI doesn't need product dependencies or internal npm-feed credentials.

The watcher checks every 30 seconds and waits for edits to settle. It tracks book files, working changes to product sources, repository guidance, and the selected checkout's commit. Updating VS Code in that checkout triggers a new snapshot; the publisher doesn't fetch, merge, or overwrite the author's working branch. It doesn't follow a different checkout automatically.

Keep the watcher on a persistent execution host if updates must continue after the client disconnects. Use the host's supported service/background mechanism, retain its process handle and logs, and stop it when no longer needed. This command doesn't silently install an OS service.

A source race discards the export and reports it; the watcher retries after edits settle. An export, access-control change, signing failure, remote change, or push failure stops the publisher with an error. Resolve the cause before restarting; failed exports don't overwrite a deployed snapshot. Confirm the Pages workflow succeeded, open the returned website while signed in, and check that an anonymous browser cannot read it before distributing the URL.
