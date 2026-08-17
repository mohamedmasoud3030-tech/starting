import { createContext, useContext } from "react";

/**
 * Carries the id of the field's error paragraph so inputs rendered inside
 * the field can announce it through `aria-describedby` — screen readers hear
 * the validation message the same way sighted users see it.
 *
 * Lives in its own module (not in Field.tsx) so component files keep their
 * single-component fast-refresh contract.
 */
const FieldErrorContext = createContext<string | undefined>(undefined);

export function useFieldErrorId(): string | undefined {
  return useContext(FieldErrorContext);
}

export { FieldErrorContext };
