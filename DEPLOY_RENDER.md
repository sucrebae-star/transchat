# TRANSCHAT Render Deploy

## First deploy

1. Push this folder to a GitHub repository.
2. In Render, choose `New +` -> `Blueprint`.
3. Select the repository that contains this project.
4. Render will detect `render.yaml` automatically.
5. Add the `OPENAI_API_KEY` environment variable in Render.
6. Deploy the service.

## Re-deploy after code changes

Use only the files you actually changed.

```powershell
cd C:\dev\Transchat
git add server.mjs render.yaml DEPLOY_RENDER.md
git commit -m "Improve translation prompt quality"
git push origin main
```

Then deploy in Render:

- If auto deploy is enabled: pushing to `main` starts the deploy automatically.
- If auto deploy is disabled: open the `transchat` service in Render, then choose `Manual Deploy` -> `Deploy latest commit`.

## Translation quality tuning

Default Render settings in this project:

- `OPENAI_TRANSLATION_MODEL=gpt-5-mini`
- `OPENAI_TRANSLATION_REASONING_EFFORT=low`

If you want to temporarily spend more for higher translation quality, open the Render dashboard and change environment variables:

- Set `OPENAI_TRANSLATION_MODEL` to a larger GPT-5 family model your API account can access, for example `gpt-5.1`.
- Set `OPENAI_TRANSLATION_REASONING_EFFORT` to `medium` or `high`.
- Deploy again after saving the environment changes.

After testing, you can reduce cost by switching back to:

- `OPENAI_TRANSLATION_MODEL=gpt-5-mini`
- `OPENAI_TRANSLATION_REASONING_EFFORT=low`

## Notes

- Render will generate the public URL automatically after deploy.
- The current room state file is stored locally in `transchat-server-state.json`, so on free hosting it can reset when the service restarts.
- For production persistence later, replace file storage with a real database.
