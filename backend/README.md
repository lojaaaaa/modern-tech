# Modern Tech API

Laravel modular backend. See the repository README for Docker startup and administrator creation.

Modules: Identity, Access, Documents, Processing, Collaboration, Audit, Integrations.

Run `make test`, `make lint` and `make smoke` from the repository root. `tests/Smoke/pipeline.php` exercises real local ClamAV, Tika and PostgreSQL, rolls back its database transaction and removes its temporary original. No live cloud credentials are required by tests.

`contracts/openapi.json` is exported with Scramble. The contract currently describes implemented endpoints, not every planned endpoint.
