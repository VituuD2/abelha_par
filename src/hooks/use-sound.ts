"use client";

import { useCallback } from "react";
import { playSuccess, playError } from "@/lib/sounds";

export function useSound() {
  const success = useCallback(() => {
    playSuccess();
  }, []);

  const error = useCallback(() => {
    playError();
  }, []);

  return { playSuccess: success, playError: error };
}
