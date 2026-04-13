# TRANSCHAT Render Deploy

1. Push this folder to a GitHub repository.
2. In Render, choose `New +` -> `Blueprint`.
3. Select the repository that contains this project.
4. Render will detect `render.yaml` automatically.
5. Add the `OPENAI_API_KEY` environment variable in Render.
6. Deploy the service.

Notes:
- Render will generate the public URL automatically after deploy.
- The current room state file is stored locally in `transchat-server-state.json`, so on free hosting it can reset when the service restarts.
- For production persistence later, replace file storage with a real database.
