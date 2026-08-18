import React, { useState } from 'react';
import StatusBadge from './StatusBadge.jsx';
import { generateProofStub } from '../utils/proofStub.js';

const CURRENT_YEAR = new Date().getFullYear();
const THRESHOLD = 18;

function ProveForm({ onProofSuccess }) {
  // NEVER stored in localStorage — React state only
  const [birthYear, setBirthYear] = useState('');
  const [secretSalt, setSecretSalt] = useState('');
  const [status, setStatus] = useState('idle'); // idle | generating | success | error
  const [errorMsg, setErrorMsg] = useState('');

  const handleSubmit = async (e) => {
    e.preventDefault();
    if (!birthYear || !secretSalt) {
      setStatus('error');
      setErrorMsg('Please fill in all fields.');
      return;
    }

    const age = CURRENT_YEAR - Number(birthYear);
    if (age < 0 || Number(birthYear) < 1900 || Number(birthYear) > CURRENT_YEAR) {
      setStatus('error');
      setErrorMsg('Please enter a valid birth year.');
      return;
    }

    setStatus('generating');
    setErrorMsg('');

    try {
      const result = await generateProofStub({
        birthYear: Number(birthYear),
        secretSalt: Number(secretSalt),
        currentYear: CURRENT_YEAR,
        threshold: THRESHOLD,
      });
      setStatus('success');
      // Clear sensitive fields immediately after proof generation
      setBirthYear('');
      setSecretSalt('');
      if (onProofSuccess) onProofSuccess(result);
    } catch (err) {
      setStatus('error');
      setErrorMsg(err.message || 'Proof generation failed.');
    }
  };

  const isGenerating = status === 'generating';

  return (
    <form onSubmit={handleSubmit} autoComplete="off">
      <div className="form-group">
        <label className="label-private" htmlFor="birthYear">
          <span>🔒</span> Birth Year
        </label>
        <input
          id="birthYear"
          type="number"
          min="1900"
          max={CURRENT_YEAR}
          placeholder="e.g. 1990"
          value={birthYear}
          onChange={(e) => setBirthYear(e.target.value)}
          disabled={isGenerating}
          autoComplete="off"
          required
        />
      </div>

      <div className="form-group">
        <label className="label-private" htmlFor="secretSalt">
          <span>🔒</span> Secret Salt
        </label>
        <input
          id="secretSalt"
          type="number"
          placeholder="e.g. 123456"
          value={secretSalt}
          onChange={(e) => setSecretSalt(e.target.value)}
          disabled={isGenerating}
          autoComplete="off"
          required
        />
      </div>

      <div className="form-group">
        <label htmlFor="currentYear">Current Year</label>
        <input
          id="currentYear"
          type="number"
          value={CURRENT_YEAR}
          readOnly
        />
      </div>

      <div className="form-group">
        <label htmlFor="threshold">Age Threshold</label>
        <input
          id="threshold"
          type="number"
          value={THRESHOLD}
          readOnly
        />
      </div>

      <button
        type="submit"
        className="btn btn-primary"
        disabled={isGenerating}
        style={{ marginTop: '0.5rem' }}
      >
        {isGenerating ? 'Generating...' : 'Generate Proof'}
      </button>

      <StatusBadge status={status} errorMsg={errorMsg} />
    </form>
  );
}

export default ProveForm;
