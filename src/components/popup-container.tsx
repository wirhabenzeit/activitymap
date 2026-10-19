'use client';

import { createContext, useContext } from 'react';

// A product surface can keep nested portals in its stacking context. Outside
// such a surface Radix retains its normal document.body portal behavior.
const PopupContainerContext = createContext<HTMLElement | undefined>(undefined);
export const PopupContainerProvider = PopupContainerContext.Provider;
export function usePopupContainer() {
  return useContext(PopupContainerContext);
}
