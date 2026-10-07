import { lazy, Suspense } from 'react';
import { Redirect, Route, Switch } from 'wouter';
import { Toaster } from './components/Toaster';
import { HomePage } from './pages/HomePage';

// Calibration (fixing the curb outline) is a rarely used desktop tool; keep it out of the main bundle.
const CalibratePage = lazy(() => import('./pages/CalibratePage'));

export function App() {
  return (
    <>
      <Switch>
        <Route path="/" component={HomePage} />
        <Route path="/calibrate/:cameraId">
          {(params) => (
            <Suspense fallback={<div className="page" aria-busy="true" />}>
              <CalibratePage cameraId={params.cameraId} />
            </Suspense>
          )}
        </Route>
        <Route>
          <Redirect to="/" replace />
        </Route>
      </Switch>
      <Toaster />
    </>
  );
}
