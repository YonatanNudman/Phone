import { lazy, Suspense, useEffect } from 'react';
import { Redirect, Route, Switch, useLocation } from 'wouter';
import { Toaster } from './components/Toaster';
import { CamerasPage } from './pages/CamerasPage';
import { MapPage } from './pages/MapPage';
import { SettingsPage } from './pages/SettingsPage';

// Calibration is a desktop tool; keep it out of the main bundle.
const CalibratePage = lazy(() => import('./pages/CalibratePage'));

export function App() {
  const [location] = useLocation();
  useEffect(() => {
    window.scrollTo(0, 0);
  }, [location]);

  return (
    <>
      <Switch>
        <Route path="/" component={MapPage} />
        <Route path="/cameras" component={CamerasPage} />
        <Route path="/calibrate/:cameraId">
          {(params) => (
            <Suspense fallback={<div className="page" aria-busy="true" />}>
              <CalibratePage cameraId={params.cameraId} />
            </Suspense>
          )}
        </Route>
        <Route path="/settings" component={SettingsPage} />
        <Route>
          <Redirect to="/" replace />
        </Route>
      </Switch>
      <Toaster />
    </>
  );
}
