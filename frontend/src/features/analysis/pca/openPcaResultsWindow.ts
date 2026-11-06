import { useAppStore } from '../../../store/appStore';
import { getWorkspaceApi } from '../../workspace/workspaceApi';

/** Show the PCA results window in the Plots view (reusing an open one); returns its plot id. */
export function openPcaResultsWindow(): string {
  const app = useAppStore.getState();
  const existing = app.plots.find(p => p.type === 'pca');
  const id = existing?.id ?? app.addPlot('pca', { title: 'PCA results' });
  app.setCurrentView('plots');
  // The dock may mount after the view switch
  requestAnimationFrame(() => getWorkspaceApi()?.getPanel(id)?.api.setActive());
  return id;
}
