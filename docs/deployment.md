# Deployment, publishing, and recovery

## Build and deploy public viewer

The viewer is read-only in public mode. Vercel `VERCEL=1` fails closed on the server; `vercel.json` and build-time `NEXT_PUBLIC_BEYONDERS_MODE=public` switch client controls. Deploy only after real packages are in `public/studies/` and checksums pass.

1. Review changed files and ensure no `.env`, Earthdata login files, `pipeline/venv`, private `pipeline/output`, full raw `.h5`, job logs, recordings, or video tools enter the commit. Reviewed compact volcano crops/GeoTIFFs under their published version are intentional public artifacts. `.vercelignore` excludes processing inputs and allows the volcano evidence ZIP. Inspect package size before deploying; move larger downloads to GitHub Releases as needed.
2. Run `npm run lint`, `npm run build`, and Python unit/release tests.
3. Commit source and reviewed web publication files. Push the branch through your GitHub workflow; connect that repository to Vercel with public environment mode.
4. Check the deployed `/wetland/global`, `/volcano/global`, `/volcano/hayli-gubbi`, `/operator-guide`, `/studies/catalog.json`, and one study/date. Verify POST `/api/wetland/processing`, POST `/api/wetland/site-name`, and GET `/api/wetland/probe` return 403 in public mode.
5. Keep large source downloads as GitHub Release assets. Link using the release HTTPS URL when producing the publication package.

Vercel Hobby use is restricted to personal, non-commercial usage; check current plan terms before deployment/use. The application may call external NASA services whose uptime/quotas are separate from hosting.

## Local rebuild and rollback

A published version and its `publication.json` checksums make the deployment inputs auditable. To rollback, revert the catalog to a prior `releases/<version>/runs/<run-id>` entry, verify it still exists, rebuild and deploy. Reprocessing satellite granules is not required. Retain a copy of `public/studies` and GitHub Release assets outside the checkout.

For volcano rollback, restore both `public/volcanoes/hayli-gubbi/index.json` and its `public/volcanoes/catalog.json` entry to a retained version, verify checksums, and rebuild. No science download or Earthdata secret is required. Confirm the case's evidence ZIP and native GeoTIFF links work on the deployed host.

## Failures

- Missing catalog/current pointer: publish at least one complete run before build.
- Missing preview/evidence: prepare on the operator host and publish a new version.
- NASA CMR/GIBS unavailable: surface cached snapshot/date and say live coverage is unavailable.
- Earthdata offline: retry bounded remote actions later; previous current run remains usable.
- Invalid checksums/stale evidence: stop publish, fix source/rebuild, bump publication version.
- Public route reports a local pipeline error: verify build mode is `public` and redeploy; do not add Earthdata secrets to Vercel.
