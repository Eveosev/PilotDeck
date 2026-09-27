// @vitest-environment jsdom
import { createPortal } from 'react-dom';
import { cleanup, render, screen, waitFor, within } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

let currentLanguage = 'zh-CN';
vi.mock('react-i18next', () => ({ useTranslation: () => ({ i18n: { resolvedLanguage: currentLanguage } }) }));
import StaffDeckLocaleBoundary from './StaffDeckLocaleBoundary';

afterEach(() => { cleanup(); currentLanguage = 'zh-CN'; });

function Fixture() {
  return <StaffDeckLocaleBoundary>
    <button type="button">新增</button>
    <span data-i18n-ignore="true" translate="no">新增</span>
    {createPortal(<div data-staffdeck-portal-root="true" role="dialog">
      <h2>版本详情</h2>
      <button type="button">取消</button>
      <span data-i18n-ignore="true" translate="no" title="名称">暂无内容</span>
    </div>, document.body)}
  </StaffDeckLocaleBoundary>;
}

describe('formal StaffDeck locale boundary', () => {
  it('localizes only formal labels inside the page and its Portal while keeping user text and attributes unchanged', async () => {
    const { rerender } = render(<Fixture />);
    const dialog = screen.getByRole('dialog');
    const resource = within(dialog).getByText('暂无内容');
    currentLanguage = 'en';
    rerender(<Fixture />);
    expect(await screen.findByRole('button', { name: 'Add' })).toBeTruthy();
    expect(within(dialog).getByRole('heading', { name: 'Version Details' })).toBeTruthy();
    expect(within(dialog).getByRole('button', { name: 'Cancel' })).toBeTruthy();
    expect(resource.textContent).toBe('暂无内容');
    expect(resource.getAttribute('title')).toBe('名称');
    currentLanguage = 'zh-CN';
    rerender(<Fixture />);
    await waitFor(() => expect(screen.getByRole('button', { name: '新增' })).toBeTruthy());
    expect(within(dialog).getByRole('heading', { name: '版本详情' })).toBeTruthy();
    expect(resource.textContent).toBe('暂无内容');
  });
});
