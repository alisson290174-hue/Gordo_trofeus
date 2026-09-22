import { Icon } from "@renderer/components/icon/icon";

export const routes = [
  {
    path: "/",
    nameKey: "home",
    render: () => <Icon name="home" size={16} />,
  },
  {
    path: "/catalogue",
    nameKey: "catalogue",
    render: () => <Icon name="apps" size={16} />,
  },
  {
    path: "/library",
    nameKey: "library",
    render: () => <Icon name="book" size={16} />,
  },
  {
    path: "/downloads",
    nameKey: "downloads",
    render: () => <Icon name="downloads" size={16} />,
  },
  {
    path: "/settings",
    nameKey: "settings",
    render: () => <Icon name="settings" size={16} />,
  },
];
