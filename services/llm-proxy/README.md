# SmartFill LLM proxy

Optional. SmartFill works fully offline without it. The proxy lets the extension use an Anthropic model as a
last-resort tie-breaker for form fields that rules and the on-device model could not settle, **without** putting
an API key in the browser.

## What it sees
Only field descriptions (label, placeholder, section heading, page title) and 1–8 candidate profile *keys*
per field. Never profile values, URLs or page contents. Answers are re-validated: any key outside the
candidate list is dropped, and the extension caps LLM confidence below the auto-fill threshold.

## Run
```bash
cd services/llm-proxy
pip install -r requirements.txt
export ANTHROPIC_API_KEY=...            # stays on the server
export SMARTFILL_TOKEN=choose-a-secret  # optional shared secret (enter it in the extension's AI settings)
uvicorn main:app --port 8787 --no-access-log
```
Then in the extension: **Options → AI assist → My proxy server**, endpoint `http://localhost:8787`
(use HTTPS for any non-local deployment — the extension refuses plain HTTP otherwise).

## Settings (environment)
| Variable | Default | Meaning |
|---|---|---|
| `ANTHROPIC_API_KEY` | – | required |
| `SMARTFILL_MODEL` | `claude-opus-5-5` | model id |
| `SMARTFILL_RATE_LIMIT` | 30 | requests / minute / client |
| `SMARTFILL_MAX_BODY` | 65536 | request size cap (bytes) |
| `SMARTFILL_TOKEN` | – | require header `X-SmartFill-Token` |
| `SMARTFILL_ALLOWED_ORIGINS` | – | comma-separated CORS origins |

Request bodies and model output are never logged. Upstream errors are not echoed to the client.

## Test
```bash
pip install -r requirements-dev.txt && pytest
```

## Without a proxy
Choose **Groq** in the extension instead and use your own Groq API key directly (stored in the browser; see the privacy notes in the AI settings).
