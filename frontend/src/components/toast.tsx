import { createContext, useContext, useState, type ReactNode } from "react";

type ToastItem = {
  id: number;
  tone: "success" | "error";
  title: string;
  description?: string;
};

type ToastContextValue = {
  notify: (toast: Omit<ToastItem, "id">) => void;
};

const ToastContext = createContext<ToastContextValue | undefined>(undefined);

export function ToastProvider({ children }: { children: ReactNode }) {
  const [items, setItems] = useState<ToastItem[]>([]);

  const value: ToastContextValue = {
    notify: (toast) => {
      const next = {
        ...toast,
        id: Date.now() + Math.round(Math.random() * 1000),
      };

      setItems((current) => [...current, next]);
      window.setTimeout(() => {
        setItems((current) => current.filter((item) => item.id !== next.id));
      }, 3600);
    },
  };

  return (
    <ToastContext.Provider value={value}>
      {children}
      <div className="toast-stack" aria-live="polite" aria-atomic="true">
        {items.map((item) => (
          <div key={item.id} className={`toast toast--${item.tone}`}>
            <strong>{item.title}</strong>
            {item.description ? <p>{item.description}</p> : null}
          </div>
        ))}
      </div>
    </ToastContext.Provider>
  );
}

export function useToast() {
  const context = useContext(ToastContext);

  if (!context) {
    throw new Error("useToast must be used inside ToastProvider");
  }

  return context;
}
