# Content-identical ONLYOFFICE mirror probes — 2026-11-07

Bounded read-only exploration. Existing daemon pulls were not interrupted; no Docker configuration was changed; no full mirror image transfer was started; no remote repository operation was performed.

## Result

**Three provider mirrors expose the exact pinned ARM64 manifest and configuration, but none demonstrated faster useful delivery.** Google is a verified fallback, not a measured acceleration. Keep the current download unless another operational reason justifies switching. Small probes ran alongside the active original pulls and are not an uncontended bandwidth benchmark.

The authoritative Docker Hub ARM64 manifest is:

`sha256:4cf3b55487209b8f53492c545263b7bb257e1be48dba1f9e0b30d2e50371a1c8`

It references configuration:

`sha256:5dce463a5cdb73e31cec3f6ecf47066348bece06ebf96684c05c3521c77babdd`

For each successful metadata probe, the complete downloaded ARM64 manifest was SHA256-checked against that digest and compared with the official saved manifest; this confirms the same descriptors, sizes and hashes for **all nine layers**. The full 13,144-byte image configuration was separately SHA256-checked. Partial layer samples cannot establish a whole layer's content hash; a full Docker pull must still verify every complete blob digest before loading/running it.

## Actual probes

| Provider mirror | Exact manifest/config | Largest-layer body sample | Measured result |
| --- | --- | --- | --- |
| `mirror.gcr.io` | Yes, all nine layer descriptors identical | HTTP 206, exact first 1 MiB Content-Range | **1,048,576 bytes / 6.558 s = 159,897 B/s** |
| `mirror.gcr.io`, eight distinct 256 KiB ranges | Metadata verified beforehand | All eight HTTP 206 with exact Content-Range | **2,097,152 bytes / 20.172 s = 103,966 B/s aggregate**; individual completions 5.833–20.168 s |
| `dockerhub.timeweb.cloud` | Yes, all nine layer descriptors identical | Server ignored Range and returned HTTP 200; reader stopped after exactly 1 MiB | **1,048,576 bytes / 8.817 s = 118,926 B/s**; this endpoint cannot presently support verified multipart ranges |
| `docker.m.daocloud.io` | Yes after anonymous public token challenge, all nine layer descriptors identical | Blob request failed before body | HTTP **503**; no usable throughput measurement |
| `dh-mirror.gitverse.ru` | No artifact obtained | No body sample | Direct pinned-tag manifest request returned HTTP **404** |

The original Docker-route bounded eight-range probe was approximately 219 KB/s; these mirror samples do not improve it. No duplicate full-image transfer is justified by these measurements.

## Verified fallback reference

If the original registry becomes unavailable, this exact content-addressed Google reference identifies the verified ARM64 image:

```sh
docker pull --platform linux/arm64 mirror.gcr.io/onlyoffice/documentserver@sha256:4cf3b55487209b8f53492c545263b7bb257e1be48dba1f9e0b30d2e50371a1c8
```

This command was **not run** in the exploration and is **not claimed faster**. Google documents daemon-based mirror configuration as its supported integration; the direct Registry v2 metadata and bounded blob requests above worked, but a whole direct Docker pull remains an untested operational path. Do not restart/reconfigure the daemon to try it while existing services/pulls are active.

## Evidence and reproduction

- Generic bounded metadata/config/1-MiB probe: `/tmp/modern-tech-office-mirror-probe.py`; arguments `mirror.gcr.io`, `dockerhub.timeweb.cloud` or `docker.m.daocloud.io`.
- Exact manifest/config copies: `/tmp/modern-tech-mirror-gcr-io-{arm64-manifest,image-config}.json`, `/tmp/modern-tech-dockerhub-timeweb-cloud-{arm64-manifest,image-config}.json`, `/tmp/modern-tech-docker-m-daocloud-io-{arm64-manifest,image-config}.json`.
- Body probe results: `/tmp/modern-tech-mirror-gcr-io-range-result.json`, `/tmp/modern-tech-dockerhub-timeweb-cloud-range-result.json`.
- Google eight-range probe: `/tmp/modern-tech-office-gcr-parallel-probe.py`; raw report `/tmp/modern-tech-office-gcr-parallel-result.json`.
- Mirror tag indexes/response headers: `/tmp/modern-tech-mirror-{gcr,timeweb,daocloud,gitverse}-*`.
- Anonymous registry tokens and temporary signed delivery URLs were not printed. Only public image metadata and body byte counts were reported.

## Primary provider documentation

- [Google Artifact Registry Docker Hub cache](https://docs.cloud.google.com/artifact-registry/docs/pull-cached-dockerhub-images): Google-managed cache, cache availability not guaranteed; official integration uses daemon mirror configuration.
- [Timeweb mirror endpoint instructions](https://dockerhub.timeweb.cloud/), [Timeweb provider announcement](https://timeweb.cloud/blog/besplatnyj-proksi-k-docker-hub): explicit registry prefix is supported without a daemon restart.
- [DaoCloud public-image-mirror project](https://github.com/DaoCloud/public-image-mirror): provider-owned mirror project. A public anonymous token challenge was handled only for the documented `docker.m.daocloud.io` host.
- [GitVerse Docker Hub mirror documentation](https://gitverse.ru/docs/artifactory/registry-mirrors/dh-mirror/): documents both daemon configuration and direct image prefix; it does not guarantee any particular image is present.

Provider ownership alone is not image provenance. The content comparisons above are the reason these metadata are treated as the same image; mutable tag labels were not accepted as proof.
