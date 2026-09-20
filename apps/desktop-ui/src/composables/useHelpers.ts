export const useHelpers = () => {
  const resetGlobalFocus = () => {
    const activeElement = document.activeElement as any;
    if (activeElement?.blur && typeof activeElement.blur === "function") {
      activeElement.blur();
    }
  };

  return {
    resetGlobalFocus,
  };
};
