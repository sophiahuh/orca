"use client";

import { createContext, useContext, useMemo, useState, type ReactNode } from "react";
import { type AvatarId, DEFAULT_AVATAR } from "@/lib/avatars";

/**
 * The avatar the top bar shows before there is a profile to read it from: the sign-up picker's
 * current choice (Figma: 13 · Sign up shows it in the header as you pick). In memory only.
 */
const Ctx = createContext<{ preview: AvatarId; setPreview: (a: AvatarId) => void }>({ preview: DEFAULT_AVATAR, setPreview: () => {} });

export function AvatarPreviewProvider({ children }: { children: ReactNode }) {
  const [preview, setPreview] = useState<AvatarId>(DEFAULT_AVATAR);
  const value = useMemo(() => ({ preview, setPreview }), [preview]);
  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}

export function useAvatarPreview() {
  return useContext(Ctx);
}
