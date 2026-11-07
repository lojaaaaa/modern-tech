# Official ONLYOFFICE download routes — 2026-11-07

No faster route was verified. Keep the existing Docker pull running. None of the probes changed Docker configuration, interrupted the pull, installed packages, or fetched a second full image/package.

## Exact image metadata verified live

Docker Hub `onlyoffice/documentserver:9.4.0.1` resolves to ARM64 manifest:

`sha256:4cf3b55487209b8f53492c545263b7bb257e1be48dba1f9e0b30d2e50371a1c8`

Config: `sha256:5dce463a5cdb73e31cec3f6ecf47066348bece06ebf96684c05c3521c77babdd`.

Compressed layers total **1,410,837,529 bytes**. The largest layer alone is **1,033,072,395 bytes**, digest `sha256:33343af06789537517a8bd3bd47b5eaf62df80de4078fb1a9d566ddefc3b3ace`.

Evidence: `/tmp/modern-tech-office-arm64-manifest.json`, `/tmp/modern-tech-office-registry-index.json`. Probe script: `/tmp/modern-tech-office-registry-probe.py`. The script fetched public registry metadata using an anonymous Docker Hub token, verified the ARM64 manifest hash, then read only 1 MiB of the largest layer. It does not print the token or signed blob URL.

## Small measured probes

| Route | Actual bytes | Duration | Throughput | Result |
| --- | ---: | ---: | ---: | --- |
| Same official Docker Hub blob through host HTTPS | 1,048,576 | 19.532 s | 53,686 B/s | HTTP 206; redirected to `production.cloudfront.docker.com`; slower than reported active Docker aggregate |
| Official GitHub ARM64 .deb release, requested first 4 MiB | 1,768,746 | 24.999 s | 70,751 B/s | HTTP 206; capped at 25-second timeout |
| Official ONLYOFFICE apt CDN .deb, requested first 1 MiB | 261,042 | 20.003 s | 13,050 B/s | HTTP 206; capped at 20-second timeout |

Small probes were concurrent with the existing pull, so these are observations under contention rather than independent link capacity benchmarks. They provide no evidence to abandon the current pull.

## Verified alternate package route

The official ARM64 apt index retains:

- Package `onlyoffice-documentserver`, version **9.4.0-129**.
- Size **697,482,472** bytes.
- SHA256 **5bbe4194d91b1812020ef9fca25da705212ca9b89f668851ffffecd15b482623**.
- URL `https://download.onlyoffice.com/repo/debian/pool/main/o/onlyoffice-documentserver/onlyoffice-documentserver_9.4.0_arm64.deb`.
- Official GitHub release asset: `https://github.com/ONLYOFFICE/DocumentServer/releases/download/v9.4.0/onlyoffice-documentserver_arm64.deb` (same size).

Index evidence: `/tmp/modern-tech-office-Packages.gz`; release evidence: `/tmp/modern-tech-office-release.json`. A rebuilt container around this official package could test the same editor build **after verifying the Debian package version and hash**, but it would not have the exact official Docker image digest or necessarily identical dependencies. It would require a reproducibly pinned base/recipe and dependencies, and current speed probes show no improvement, so it is not recommended now.

## Registries and provenance

The official `Docker-DocumentServer` README, stable-build workflow and `docker-bake.hcl` reviewed in this exploration publish to **docker.io**. No official GHCR/multi-registry publication for this pinned version was found. Do not substitute an unverified community mirror. A content-identical mirror would have to produce the exact manifest/config/layer digests above before it could be treated as this image.

Primary sources: [official Docker repository](https://github.com/ONLYOFFICE/Docker-DocumentServer), [official bake recipe](https://github.com/ONLYOFFICE/Docker-DocumentServer/blob/master/docker-bake.hcl), [official Dockerfile](https://github.com/ONLYOFFICE/Docker-DocumentServer/blob/master/Dockerfile), [official v9.4.0 release](https://github.com/ONLYOFFICE/DocumentServer/releases/tag/v9.4.0), [official ARM64 package index](https://download.onlyoffice.com/repo/debian/dists/squeeze/main/binary-arm64/Packages.gz), [official image tags](https://hub.docker.com/r/onlyoffice/documentserver/tags).

## Final bounded parallel-range experiment

Ran an authenticated one-byte registry GET to obtain the official CloudFront redirect (HEAD does not redirect), then a 256 KiB baseline and **8 concurrent distinct 256 KiB ranges**, total **2 MiB**, against the same pinned largest layer. All actual range responses were checked for HTTP 206 and the exact Content-Range. The active Docker daemon pull was left running.

- Single range: **262,144 bytes / 3.558 s = 73,672 B/s**.
- Eight parallel ranges: **2,097,152 bytes / 9.584 s = 218,814 B/s**, about **2.97×** the single-stream probe.
- Individual range completion times: 2.160–9.577 s; all eight completed.
- Host: `production.cloudfront.docker.com`. No anonymous token or signed URL was printed.

Parallel requests improve this small host probe over a single stream, but **the measured aggregate is still only approximately 0.22 MB/s**, comparable to the reported active Docker pull. This is not evidence of a substantially faster full-image transfer. At that measured rate, the 1.033 GB largest layer alone would require approximately 79 minutes; this is only arithmetic, not a forecast, because concurrent daemon traffic and request overhead affect measurements. Do not start a duplicate full-image download based on this result.

If a later measurement demonstrates a materially faster route, a content-preserving multipart transfer can: (1) download distinct ranges of each official blob into temporary parts; (2) verify complete coverage and exact total size before concatenating; (3) verify each completed blob SHA256 against the official ARM64 manifest; (4) verify config and manifest digests; (5) construct an OCI archive referencing those exact blobs and load it into Docker, then verify the resulting image configuration and architecture. This route needs a full-transfer decision and a tested archive-import path; it is not implemented or claimed faster here.

Script: `/tmp/modern-tech-office-parallel-range-probe.py`. Raw results: `/tmp/modern-tech-office-parallel-range-result.json`. The initial HEAD-based probe received auth errors and transferred no body bytes; it was corrected before the measurements above.
