"""Validate an iOS release and record exactly what this workflow builds."""
import json
import os
from pathlib import Path
import re
import subprocess


def release_version(tag):
    match = re.fullmatch(r"ios/v(\d+\.\d+\.\d+)(?:-[A-Za-z0-9][A-Za-z0-9.-]*)?", tag)
    if not match:
        raise ValueError("Expected a release tag such as ios/v1.0.0 or ios/v1.0.0-beta.2")
    return match[1]


def build_number(run, attempt):
    # Keep Apple's first component <= 4 digits and second <= 2 digits.
    # Start above the local builds, and make a rerun a new uploadable build.
    major, minor = int(run) + 100, int(attempt)
    if not (100 < major <= 9999 and 1 <= minor <= 99):
        raise ValueError("Build number range exhausted; update the numbering scheme")
    return f"{major}.{minor}"


if __name__ == "__main__":
    version = release_version(os.environ["RELEASE_TAG"])
    build = build_number(os.environ["GITHUB_RUN_NUMBER"], os.environ["GITHUB_RUN_ATTEMPT"])
    sha = subprocess.check_output(["git", "rev-parse", "HEAD"], text=True).strip()
    if sha != os.environ["GITHUB_SHA"]:
        raise ValueError("Checkout does not match the release event SHA")
    output = Path(os.environ["RUNNER_TEMP"]) / "testflight-output"
    output.mkdir(exist_ok=True)
    provenance = dict(version=version, build=build, source_commit=sha,
                      release_tag=os.environ["RELEASE_TAG"],
                      run_url=f"{os.environ['GITHUB_SERVER_URL']}/{os.environ['GITHUB_REPOSITORY']}/actions/runs/{os.environ['GITHUB_RUN_ID']}")
    (output / "source.json").write_text(json.dumps(provenance, indent=2) + "\n")
    with open(os.environ["GITHUB_ENV"], "a") as file:
        file.write(f"APP_VERSION={version}\nBUILD_NUMBER={build}\n")
    print(json.dumps(provenance, indent=2))
