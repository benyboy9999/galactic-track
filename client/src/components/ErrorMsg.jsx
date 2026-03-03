export default function ErrorMsg({ message }) {
  return (
    <div style={{ color: '#f87171', padding: '1rem', background: '#1a0000', borderRadius: 8, margin: '1rem 0' }}>
      Error: {message}
    </div>
  );
}
