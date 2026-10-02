import { useId } from 'react';
import { FRAME_RATES } from './frame-rate.js';
import { MODES } from './preferences.js';

const DETAILS = {
  native: ['nativeDetail'],
  optimized: ['optimizedSweep', 'optimizedDots', 'optimizedText', 'optimizedPause', 'systemMotion'],
  reduced: ['reducedSweep', 'reducedDots', 'reducedText'],
};

/** The renderer supplies the preference hooks; this component owns no subscription. */
export function SettingsPage({ useLowMotion, setMode, useFrameRate, setFrameRate, useShimmerRenderer, setRenderer, t }) {
  const state = useLowMotion(value => value);
  const renderer = useShimmerRenderer(value => value);
  const rate = useFrameRate(value => value);
  const id = useId();
  return (
    <section className="dsh-lm-page" data-low-motion-settings="">
      <header>
        <h2>{t('title')}</h2>
        <p className="dsh-lm-description">{t('description')}</p>
      </header>
      <div className="dsh-lm-card">
        <fieldset className="dsh-lm-control" disabled={!state.allowed}
          aria-describedby={id + '-description' + (!state.allowed ? ' ' + id + '-locked' : '')}>
          <legend className="dsh-lm-label">{t('mode')}</legend>
          <p id={id + '-description'}>{t('modeDescription')}</p>
          <div className="dsh-lm-options">
            {MODES.map(mode => (
              <label className="dsh-lm-option" data-selected={state.preference === mode} key={mode}>
                <input className="dsh-lm-radio" type="radio" name={id + '-mode'} value={mode}
                  checked={state.preference === mode} disabled={!state.allowed}
                  aria-labelledby={id + '-' + mode + '-label'}
                  aria-describedby={id + '-' + mode + '-description'}
                  onChange={event => { if (event.target.checked) setMode(mode); }} />
                <span className="dsh-lm-option-content">
                  <span className="dsh-lm-option-title" id={id + '-' + mode + '-label'}>
                    {t(mode + 'Label')}
                    {mode === 'optimized' && <span className="dsh-lm-recommended">{t('recommended')}</span>}
                  </span>
                  <span className="dsh-lm-option-description" id={id + '-' + mode + '-description'}>
                    {t(mode + 'Description')}
                  </span>
                </span>
              </label>
            ))}
          </div>
        </fieldset>
        <div className="dsh-lm-frame-rate">
          <label htmlFor={id + '-renderer'}>{t('renderer')}</label>
          <select id={id + '-renderer'} value={renderer.renderer} disabled={!state.allowed}
            aria-describedby={id + '-renderer-description'} onChange={event => setRenderer(event.target.value)}>
            <option value="css">{t('rendererCss')}</option>
            <option value="webgl">{t('rendererWebgl')}</option>
          </select>
          <p id={id + '-renderer-description'}>{t('rendererDescription')}</p>
          {renderer.warning && <p className="dsh-lm-notice" role="alert">{t(renderer.warning)}</p>}
        </div>
        <div className="dsh-lm-frame-rate">
          <label htmlFor={id + '-frame-rate'}>{t('frameRate')}</label>
          <select id={id + '-frame-rate'} value={rate.frameRate} disabled={!state.allowed}
            aria-describedby={id + '-frame-rate-description'}
            onChange={event => setFrameRate(Number(event.target.value))}>
            {FRAME_RATES.map(value => <option key={value} value={value}>{value === 0 ? t('frameRateDisplay') : value + ' FPS'}</option>)}
          </select>
          <p id={id + '-frame-rate-description'}>{t('frameRateDescription')}</p>
          {rate.warning && <p className="dsh-lm-notice" role="alert">{t(rate.warning)}</p>}
        </div>
        <div className="dsh-lm-status" role="status" aria-live="polite" aria-atomic="true">
          <span className="dsh-lm-badge" data-mode={state.mode}>{t(state.mode + 'Label')}</span>
          <span>{t(state.mode + 'Active')}</span>
        </div>
      </div>
      {!state.allowed && <p className="dsh-lm-notice" id={id + '-locked'}>{t('locked')}</p>}
      {state.warning && <p className="dsh-lm-notice" role="alert">{t(state.warning)}</p>}
      <div className="dsh-lm-details">
        <h3>{t('heading')}</h3>
        <ul>{DETAILS[state.mode].map(key => <li key={key}>{t(key)}</li>)}</ul>
        <p>{t('unchanged')}</p>
      </div>
      <p className="dsh-lm-scope">{t('scope')}</p>
    </section>
  );
}
