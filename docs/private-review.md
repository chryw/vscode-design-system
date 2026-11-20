# Private review snapshots

Use [the private publisher](../scripts/publish.mjs) with an authenticated `gh` account. Run it from the prepared **VS Code content checkout**, not the viewer clone.

## Private GitHub release

```sh
node /path/to/viewer/scripts/publish.mjs \
  --repository github.com/OWNER/REPOSITORY --account LOGIN --repository-only
```

Share the private repository's **Releases → Latest** link. Reviewers with repository access download `design-system.html` and open it in a browser.

## Access-controlled Pages

Use a private, organization-owned repository with **GitHub Actions** as the Pages source and private site access enabled. Prepare a clean, dedicated clone on `main` with commit signing enabled.

```sh
node /path/to/viewer/scripts/publish.mjs \
  --repository github.com/ORGANIZATION/REPOSITORY --account LOGIN \
  --checkout /absolute/path/to/review-repository
```

The publisher refuses public destinations. Add `--check` for a read-only account and visibility check, or `--watch` to rebuild from saved changes. For Pages, wait for deployment and verify that an anonymous visitor cannot open the site before sharing the URL.
