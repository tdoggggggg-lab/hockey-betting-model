// src/components/PlayerPropsTable.tsx
// This file re-exports PropsTable for backward compatibility
// The main props logic is in PropsTable.tsx

'use client';

import PropsTable from './PropsTable';

// Re-export PropsTable as PlayerPropsTable for backward compatibility
export default function PlayerPropsTable(props: any) {
  return <PropsTable {...props} />;
}
