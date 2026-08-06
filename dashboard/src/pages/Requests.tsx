import { onMount } from 'solid-js';
import { useNavigate } from '@solidjs/router';

/** Legacy /requests redirect to /analytics/logs. */
export default function Requests() {
  const navigate = useNavigate();
  onMount(() => navigate('/analytics/logs', { replace: true }));
  return null;
}
