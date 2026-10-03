// Copyright (c) 2026 BowenLabs. Louise Toolkit is MIT licensed.
//
// `louise-toolkit/client/sign-in`—the sign-in island (ADR 0019, decision 7).
// Its own subpath so a sign-in page loads neither the editor nor any auth
// client code, and the editor bundle carries none of this. It needs only
// `solid-js`; scripts/ci/checks/export-map.mjs holds the BUILT entry to that.
//
// Sign-in by link for now. The ADR's passkey half joins this subpath later.

export {
  SignInLinkForm,
  type SignInLinkFormPart,
  type SignInLinkFormProps,
  type SignInLinkMessages,
} from "./form.jsx";
export {
  type RequestSignInLinkOptions,
  requestSignInLink,
  type SignInLinkFailure,
  type SignInLinkResult,
} from "./request.js";
