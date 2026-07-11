---
"louisecms": patch
---

Fix `commerce/square` `listCatalogItems` hitting a non-existent endpoint. It
POSTed to `/v2/catalog/search-catalog-objects`, which Square returns `404
Resource not found` for — the SearchCatalogObjects endpoint is `/v2/catalog/
search`. Because the call threw, consumers that guard on "is Square configured"
could silently fall back to seed/empty data with a valid token, misdiagnosed as a
bad token. Request/response shapes are unchanged; only the URL path was wrong.
Adds a regression test pinning the endpoint path and cursor paging. (#58)
