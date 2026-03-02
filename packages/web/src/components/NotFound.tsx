import { Link, useLocation } from 'react-router-dom';
import './NotFound.css';

export function NotFound() {
  const location = useLocation();

  return (
    <div className="not-found">
      <div className="not-found-container card">
        <div className="not-found-icon">
          <i className="codicon codicon-warning" />
        </div>
        <h1>404: Not Found</h1>
        <p className="not-found-message">
          The page or resource you're looking for doesn't exist.
        </p>
        {location.pathname && (
          <p className="not-found-path">
            <code>{location.pathname}</code>
          </p>
        )}
        <div className="not-found-actions">
          <Link to="/" className="btn btn-primary">
            Go to Dashboard
          </Link>
          <Link to="/employees" className="btn btn-secondary">
            View Employees
          </Link>
        </div>
      </div>
    </div>
  );
}
