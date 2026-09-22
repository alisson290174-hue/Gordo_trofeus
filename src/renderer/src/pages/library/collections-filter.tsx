import * as DropdownMenuPrimitive from "@radix-ui/react-dropdown-menu";
import { Icon } from "@renderer/components/icon/icon";

import { useTranslation } from "react-i18next";
import type { GameCollection } from "@types";
import { useCloseOnLibraryScroll } from "./use-close-on-library-scroll";
import {
  LIBRARY_DROPDOWN_CHEVRON_SIZE,
  LIBRARY_DROPDOWN_COLLISION_PADDING,
  LIBRARY_DROPDOWN_SIDE_OFFSET,
} from "./library-dropdown";
import "./collections-filter.scss";

interface CollectionsFilterProps {
  collections: GameCollection[];
  selectedCollectionId: string | null;
  favoritesCollectionId: string;
  onSelect: (collectionId: string | null) => void;
  onCreate: () => void;
  onCollectionContextMenu: (
    event: React.MouseEvent<HTMLElement>,
    collection: GameCollection
  ) => void;
}

const getTriggerIconName = (
  selectedCollection: GameCollection | undefined,
  favoritesCollectionId: string
) => {
  if (!selectedCollection) return "file-directory";
  if (selectedCollection.id === favoritesCollectionId) return "heart-fill";
  return "file-directory-fill";
};

const getCollectionIconName = (isFavorites: boolean, isActive: boolean) => {
  if (isFavorites) {
    return isActive ? "heart-fill" : "heart";
  }
  return isActive ? "file-directory-fill" : "file-directory";
};

export function CollectionsFilter({
  collections,
  selectedCollectionId,
  favoritesCollectionId,
  onSelect,
  onCreate,
  onCollectionContextMenu,
}: Readonly<CollectionsFilterProps>) {
  const { t } = useTranslation(["library", "sidebar"]);

  const [open, setOpen] = useCloseOnLibraryScroll();

  const selectedCollection = collections.find(
    (collection) => collection.id === selectedCollectionId
  );

  const triggerIconName = getTriggerIconName(
    selectedCollection,
    favoritesCollectionId
  );

  return (
    <DropdownMenuPrimitive.Root
      modal={false}
      open={open}
      onOpenChange={setOpen}
    >
      <DropdownMenuPrimitive.Trigger asChild>
        <button
          type="button"
          className="collections-filter__trigger"
          aria-label={t("collections")}
        >
          <Icon name={triggerIconName} size={16} />
          <span className="collections-filter__trigger-label">
            {selectedCollection ? selectedCollection.name : t("collections")}
          </span>
          <Icon name="chevron-down"
            size={LIBRARY_DROPDOWN_CHEVRON_SIZE}
            className="collections-filter__chevron" />
        </button>
      </DropdownMenuPrimitive.Trigger>

      <DropdownMenuPrimitive.Portal>
        <DropdownMenuPrimitive.Content
          align="start"
          sideOffset={LIBRARY_DROPDOWN_SIDE_OFFSET}
          collisionPadding={LIBRARY_DROPDOWN_COLLISION_PADDING}
          className="collections-filter__content"
          onInteractOutside={(event) => {
            const target = event.detail.originalEvent
              .target as HTMLElement | null;
            if (target?.closest(".context-menu, [data-hydra-dialog]")) {
              event.preventDefault();
            }
          }}
        >
          <div className="collections-filter__list">
            {collections.map((collection) => {
              const isFavorites = collection.id === favoritesCollectionId;
              const isActive = collection.id === selectedCollectionId;

              const collectionIconName = getCollectionIconName(
                isFavorites,
                isActive
              );

              return (
                <DropdownMenuPrimitive.Item
                  key={collection.id}
                  className={`collections-filter__item${isActive ? " collections-filter__item--active" : ""}`}
                  onSelect={() => onSelect(isActive ? null : collection.id)}
                  onContextMenu={
                    isFavorites
                      ? undefined
                      : (event) => onCollectionContextMenu(event, collection)
                  }
                >
                  <Icon name={collectionIconName} size={16} />
                  <span className="collections-filter__item-label">
                    {collection.name}
                  </span>
                  <span className="collections-filter__item-count">
                    {collection.gamesCount}
                  </span>
                </DropdownMenuPrimitive.Item>
              );
            })}
          </div>

          <DropdownMenuPrimitive.Separator className="collections-filter__separator" />

          <DropdownMenuPrimitive.Item
            className="collections-filter__item"
            onSelect={(event) => {
              event.preventDefault();
              onCreate();
            }}
          >
            <Icon name="plus" size={16} />
            <span className="collections-filter__item-label">
              {t("create_collection", { ns: "sidebar" })}
            </span>
          </DropdownMenuPrimitive.Item>
        </DropdownMenuPrimitive.Content>
      </DropdownMenuPrimitive.Portal>
    </DropdownMenuPrimitive.Root>
  );
}
