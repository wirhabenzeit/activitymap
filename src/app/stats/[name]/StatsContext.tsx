import {
  createContext,
  useState,
  createRef,
  useLayoutEffect,
} from "react";

const settingsRef = createRef<HTMLDivElement>();
const elementRef = createRef<HTMLDivElement>();

const defaultStatsContext = {
  settingsRef,
  elementRef,
  width: 0,
  height: 0,
};

export const StatsContext = createContext(
  defaultStatsContext
);

export const StatsProvider = ({
  children,
}: {
  children: React.ReactNode;
}) => {
  const [state, setState] = useState(defaultStatsContext);

  useLayoutEffect(() => {
    const ro = new ResizeObserver((entries) => {
      for (const entry of entries) {
        const cr = entry.contentRect;
        setState((state) => ({
          ...state,
          width: cr.width,
          height: cr.height,
        }));
      }
    });

    if (elementRef.current) ro.observe(elementRef.current);
    return () => {
      if (elementRef.current)
        ro.unobserve(elementRef.current);
    };
  }, []);

  return (
    <StatsContext.Provider
      value={{
        height: state.height,
        width: state.width,
        settingsRef,
        elementRef,
      }}
    >
      {children}
    </StatsContext.Provider>
  );
};
