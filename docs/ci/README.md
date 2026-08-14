# CI workflow (prepared)

`ci.yml` here is a byte-identical copy of the workflow that must live at
`.github/workflows/ci.yml` to enable the authoritative Supabase acceptance gate
(`supabase db reset` + `supabase test db` + `supabase gen types` drift check).

It is kept under `docs/ci/` because the automated push token used for this PR
lacks the GitHub App `workflows` permission, so `.github/workflows/ci.yml`
could not be committed directly:

```
! [remote rejected] ... (refusing to allow a GitHub App to create or update
workflow `.github/workflows/ci.yml` without `workflows` permission)
```

**To enable the gate**, a repository owner with `workflows` write access should:

```bash
cp docs/ci/ci.yml .github/workflows/ci.yml
git add .github/workflows/ci.yml
git commit -m "ci: enable Supabase acceptance gate"
git push
```

The database foundation is not considered accepted until that workflow runs
successfully against the official Supabase local stack (Docker).
