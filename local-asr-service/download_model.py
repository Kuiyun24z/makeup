import os
import sys
import time

from huggingface_hub import snapshot_download


def main():
  local_dir = os.environ.get("LOCAL_ASR_MODEL_ROOT", r"D:\work\makeup\models\faster-whisper")
  repo_id = os.environ.get("LOCAL_ASR_MODEL_REPO", "Systran/faster-whisper-small")
  endpoint = os.environ.get("HF_ENDPOINT", "")

  print(f"[download] repo={repo_id}", flush=True)
  print(f"[download] local_dir={local_dir}", flush=True)
  if endpoint:
    print(f"[download] endpoint={endpoint}", flush=True)

  started_at = time.time()
  snapshot_download(
    repo_id=repo_id,
    local_dir=local_dir,
    local_dir_use_symlinks=False,
    resume_download=True,
  )
  elapsed = time.time() - started_at
  print(f"[download] done in {elapsed:.1f}s", flush=True)


if __name__ == "__main__":
  try:
    main()
  except Exception as error:
    print(f"[download] error: {error}", file=sys.stderr, flush=True)
    raise
