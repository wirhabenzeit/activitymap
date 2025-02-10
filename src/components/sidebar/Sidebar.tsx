import Filters from './filters';
import User from './user';

export default function Sidebar() {
  return (
    <div className="flex h-full w-96 flex-col overflow-y-auto bg-background p-4">
      <User />
      <Filters />
    </div>
  );
}
