# drive-project-walker

Containerized CLI tool to walk semester/project folders in a Google Shared Drive,
extract project description data, and download final deliverable decks.

## Prerequisites

- Python 3.11+ (for local/dev run) or Docker (for container run)
- A Google Cloud project with the Drive API enabled
- A service account JSON key file
- Shared Drive access granted to the service account email

## Service account setup

1. In Google Cloud Console, create/select a project.
2. Enable **Google Drive API** for that project.
3. Create a **Service Account**.
4. Create a key for the service account (JSON format) and download it.
5. Save the key file somewhere local (outside this repo), for example:
   `/path/to/keys/service_account.json`

## Share the Shared Drive with the service account

1. Copy the service account email (looks like `name@project-id.iam.gserviceaccount.com`).
2. In Google Drive, open the target Shared Drive.
3. Add that service account email as a member with at least Viewer access.
4. Confirm it can read all semester/project folders you intend to scan.

## CLI usage

```bash
drive-project-walker --root-folder-id <id> [--year-min 2023] [--output-dir ./output]
```

Arguments:

- `--root-folder-id` (required): root folder containing semester subfolders
- `--year-min` (optional): skip semester folders whose year is below this value
- `--output-dir` (optional): output directory (default `./output`)

## Run with Docker

From `drive_project_walker/`:

```bash
docker build -t drive-project-walker .

docker run \
  -v /path/to/keys:/secrets \
  -e GOOGLE_APPLICATION_CREDENTIALS=/secrets/service_account.json \
  -v $(pwd)/output:/output \
  drive-project-walker \
  --root-folder-id <id> --year-min 2023 --output-dir /output
```

## Run directly with Python (development)

From `drive_project_walker/`:

```bash
python -m venv .venv
source .venv/bin/activate
pip install -r requirements.txt

export GOOGLE_APPLICATION_CREDENTIALS=/path/to/keys/service_account.json
python walker.py --root-folder-id <id> --year-min 2023 --output-dir ./output
```

## Output files

`<output-dir>/projects.json`

- One record per fully processed project folder.
- Includes:
  - `project_name`
  - `folder_path`
  - `drive_folder_id`
  - `client_name`
  - `problem_domain`
  - `technical_components`
  - `keywords`
  - `description_text` (raw extracted text, truncated to ~2000 words)
  - `deliverable_files` (relative paths under `<output-dir>`)

`<output-dir>/skipped_projects.json`

- One record per skipped/partial project with a reason:
  - `missing_project_description`
  - `missing_final_deck`
  - `error`

`<output-dir>/deliverables/<project_name>/`

- Downloaded `.pptx` and `.pdf` files from the project's final deliverables folder.
- Files are downloaded as-is (no conversion).

## Notes

- This tool uses service-account auth only (no OAuth user flow).
- The code always uses Shared Drive-compatible Drive API calls.
- Do not commit service account keys, credentials, tokens, or local auth state.
