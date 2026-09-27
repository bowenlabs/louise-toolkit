// Copyright (c) 2026 BowenLabs. Louise Toolkit is MIT licensed.
//
// louise-toolkit/commerce/square: money.

import { centsToMajor, type Money } from "../index.js";

/** Square money is an integer amount in the currency's minor unit (cents):
 *  the shared {@link Money} shape. */
export type SquareMoney = Money;

// `centsToMajor` is a shared commerce helper (louise-toolkit/commerce); re-exported
// so `louise-toolkit/commerce/square` keeps exposing it.
export { centsToMajor };
