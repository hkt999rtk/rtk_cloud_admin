# Developer Docs content package

English Cloud Service documentation, independent of ChipSet & SDK, exposed in the Connect+ console at `/console/developer-docs`. Its Features navigation entry sits immediately below ChipSet & SDK. Begin with [Cloud Service Overview](overview.en.md).

`index.en.yaml` defines ordered navigation, summaries, categories, and search keywords. Pages carry source-version and verification metadata. `npm run build` in `web/` publishes Markdown as HTML, builds a full-text JSON index, and packages all diagrams into the Admin server image. Search runs against this curated local index without an external model or API. The JSON includes source identifiers and metadata for downstream retrieval; no vector or AI answering service is enabled by this feature.

Diagrams are authored in `assets/*.mmd` with adjacent rendered SVGs. The build rejects diagrams whose source hash does not match. Full-size images and Mermaid sources remain available from each chapter. Raw HTML in Markdown is rejected.

Run `python3 tools/check_developer_docs.py` from the Admin repository to validate metadata, links, JSON examples, SVGs, and Bash syntax. Add `--render` to regenerate diagrams using Mermaid CLI. Run `npm run prepare:developer-docs` in `web/` to rebuild the server-served index. The build reads only this public collection; maintainer records and internal design sources are never bundled.

Maintainer source mapping and qualification boundaries are in [the authoring report](../../../authoring/developer-docs.md). SDK use links to the existing ChipSet & SDK entry, where SDK documentation remains canonical.
