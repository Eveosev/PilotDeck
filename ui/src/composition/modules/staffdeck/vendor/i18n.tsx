import { createContext, useContext, type ReactNode } from 'react';

export type BusinessUiTranslate = (key: string, options?: Record<string, unknown>) => string;
export type BusinessUiI18n = { t: BusinessUiTranslate; locale?: string };

const defaultI18n: BusinessUiI18n = { t: (key) => key, locale: 'zh-CN' };
const BusinessUiI18nContext = createContext<BusinessUiI18n>(defaultI18n);

export function BusinessUiProvider({ value, children }: { value: BusinessUiI18n; children: ReactNode }) {
  return <BusinessUiI18nContext.Provider value={value}>{children}</BusinessUiI18nContext.Provider>;
}

export function useBusinessUiI18n(): BusinessUiI18n {
  return useContext(BusinessUiI18nContext);
}
