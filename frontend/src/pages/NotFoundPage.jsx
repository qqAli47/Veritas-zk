import { Link, useRouteError } from 'react-router-dom';

/**
 * Doubles as the router's errorElement. A blank white screen is the worst
 * possible failure during a live demonstration, so a render crash lands here
 * with something readable and a way out.
 */
export default function NotFoundPage({ isError = false }) {
  const error = useRouteError?.();

  return (
    <div className="page">
      <div className="card fade-in">
        <h1 className="logo" style={{ fontSize: '2rem' }}>
          Veritas
        </h1>
        <h2>{isError ? 'Something went wrong' : 'Page not found'}</h2>
        <p className="page-subtitle">
          {isError
            ? 'The application hit an unexpected error while rendering this page.'
            : 'That route does not exist.'}
        </p>

        {isError && error && (
          <details className="disclosure">
            <summary>Technical detail</summary>
            <pre className="code-block mono">{String(error?.message ?? error)}</pre>
          </details>
        )}

        <Link to="/" className="btn btn-primary btn-full">
          Back to the start
        </Link>
      </div>
    </div>
  );
}
