import SopWaitBanner from '../../components/chat-v2/SopWaitBanner';
import { useTranslation } from 'react-i18next';
import type { FrontendModule, SurfaceProps } from '../contracts';
import { ProfileTextSetting } from './shared';
import SharedSkillsPage from './staffdeck/vendor/SkillsPage';
import SharedDistillPage from './staffdeck/vendor/DistillPage';
import { PilotDeckDistillPageProvider, PilotDeckSkillsPageProvider } from './staffdeck/vendor/skills-host-adapter';

const BUILD_MARKER = 'staffdeck.sop.ui/v1';

function FormalSopPage() {
  return <PilotDeckSkillsPageProvider><SharedSkillsPage /></PilotDeckSkillsPageProvider>;
}

function FormalSopDistillPage() {
  return <PilotDeckDistillPageProvider><SharedDistillPage /></PilotDeckDistillPageProvider>;
}

function SopExtension({ sessionId, projectKey = 'general', refreshKey, disabled, onPrepared, onError }: SurfaceProps) {
  return <SopWaitBanner
    sessionKey={sessionId ?? ''}
    projectKey={projectKey}
    refreshKey={refreshKey ?? sessionId ?? ''}
    disabled={disabled}
    onPrepared={onPrepared ?? (() => {})}
    onError={onError ?? (() => {})}
  />;
}

export function SopPermissionPanel(props: SurfaceProps) {
  const { t } = useTranslation('staffdeck');
  const request = props.request ?? props.permissionRequest as { requestId?: string; toolName?: string } | undefined;
  const decide = (allow: boolean) => {
    if (!request?.requestId || !props.onDecision) return;
    props.onDecision(request.requestId, { allow, message: allow ? t('sop.approved') : t('sop.rejected') });
  };
  return <div className="rounded border border-amber-300 bg-amber-50 px-3 py-2 text-xs text-amber-900">
    <p>{t('sop.approvalRequested', { toolName: request?.toolName ?? t('sop.defaultApproval') })}</p>
    <div className="mt-2 flex gap-2">
      <button type="button" className="rounded bg-amber-700 px-2 py-1 text-white disabled:opacity-50" disabled={!request?.requestId || !props.onDecision} onClick={() => decide(true)}>{t('sop.approve')}</button>
      <button type="button" className="rounded border border-amber-700 px-2 py-1 disabled:opacity-50" disabled={!request?.requestId || !props.onDecision} onClick={() => decide(false)}>{t('sop.reject')}</button>
    </div>
  </div>;
}

const module: FrontendModule = {
  id: 'staffdeck.sop', slot: 'sop', contract: 'sop.lifecycle/v2', source: 'staffdeck', frontendApiVersion: 'frontend-module/v1',
  buildMarker: BUILD_MARKER,
  requires: ['agentLoop'],
  pages: [
    { id: 'sop', path: '/sop', label: 'Workflow', labelKey: 'staffdeck:nav.workflow', component: FormalSopPage },
    { id: 'sop-distill', path: '/sop/distill', label: 'Edit workflow', labelKey: 'staffdeck:nav.workflow', component: FormalSopDistillPage },
  ],
  settings: [{ id: 'sop-default-workflow', settingsSection: 'sop', label: 'Workflow', labelKey: 'staffdeck:nav.workflow', component: () => <SopProfileSetting /> }],
  chatExtensions: [{ id: 'sop-wait', label: 'SOP wait state', component: SopExtension, requiresRuntime: true }],
  permissionPanels: [{ id: 'sop-approval', label: 'SOP approval', toolNames: ['operator_approval'], component: SopPermissionPanel, requiresRuntime: true }],
};
export default module;

function SopProfileSetting() {
  const { t } = useTranslation('staffdeck');
  return <ProfileTextSetting slot="sop" field="defaultSopId" label={t('settings.defaultWorkflow')} description={t('settings.defaultWorkflowDescription')} />;
}
