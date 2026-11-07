# GPT Image 2.6 output support

Checked against OpenAI documentation on 2026-11-07:

- https://developers.openai.com/api/docs/changelog
- https://developers.openai.com/api/docs/guides/image-generation
- https://developers.openai.com/api/reference/resources/images/methods/generate
- https://developers.openai.com/api/reference/resources/images/methods/edit

Use the generic OpenAI Images endpoint with `gpt-image-2.6-sunburst` or
`gpt-image-2.6-flare`. Model IDs can be entered manually or loaded from the
provider's model catalog. Existing endpoint defaults are unchanged.

The generation form exposes PNG, JPEG, WebP, animated GIF and SVG, plus optional
planning complexity. Templates, task snapshots, refill and retry retain these
options. Provider-specific adapters do not silently accept unsupported options.
Actual model/format access still depends on the upstream service and account.

GIF uses `/images/generations` without references or `/images/edits` with still
reference images, defaults to 9 frames at 200 ms each, and requests
`size: auto` so the upstream can choose a size within its animation pixel budget.
Both the guide and API reference now specify 2–16 frames. Frame duration is
20–2000 ms in increments of 10. GIF preview access may be required. No streaming,
mask, compression or prompt-rewriter fields are sent. The existing medium/high
quality choices are retained.

SVG also accepts references through `/images/edits`, following the current API
reference (including its multipart schema). It requires one output, a supported
model and project access. The overview guide still says SVG edits are unsupported;
this documented discrepancy does not justify blocking a supported account locally.
Upstream access errors are returned without retries or silent raster fallback.
This does not enable SVG files as input images: references still use the existing
raster upload path. Both output formats use the configured edit model when
references are present; the effective model must support the requested options.
Up to 16 references are accepted with GPT Image 2.6 output options.

SVG output exposes an optional author model ID (`svg.model`). Templates and task
snapshots retain it. JSON generation uses `svg: { model }`; multipart edits use
`svg[model]`. Blank values omit the field and use the provider default. Providers
that require explicit author selection must be configured with an ID they
support; authoring may be billed separately. No author model is assumed locally.

GIF previews bypass static thumbnails in both the URL helper and serving route,
including older `?thumb=true` links. Original GIF frame bytes, timing and loop
metadata survive persistence. SVG downloads retain vector data; existing SVG
sanitization is supplemented by a restrictive CSP on original SVG responses.

The installed OpenAI SDK's image types predate these formats. Generation uses
its generic `post` method, retaining cancellation, timeout and disabled retries.
Edits keep the SDK multipart serializer with a compatibility type assertion at
the API boundary; GIF/SVG format and animation fields are sent unchanged.
No new dependency is required. SVG's additional authoring-model cost is not
estimated; no new fixed token-price estimate is introduced.

Local mock validation: `pnpm exec tsx scripts/test-gpt-image-output.ts`.
This checks JSON and multipart request serialization with multiple raster
references, effective edit-model selection, rejection before submission, saved
templates/tasks, GIF frames/timing/loop/pixels through preview routes, SVG
serving, legacy request behavior and no automatic retry. It does not verify a
provider's real model availability or submit paid generation requests.
