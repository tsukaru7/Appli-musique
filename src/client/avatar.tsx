import { avatarImage, findAvatar, AVATAR_IDS } from '../shared/avatars.ts'

/** Avatar d'un joueur : un personnage de la pop culture, dans un cercle. */
export function Avatar({
  id,
  size = 40,
  large = false,
  className = '',
}: {
  id?: string
  size?: number
  /** Image en meilleure qualité (aperçu en grand). */
  large?: boolean
  className?: string
}) {
  const avatar = findAvatar(id) ?? findAvatar(AVATAR_IDS[0])!
  const pokemon = avatar.id.startsWith('pk-')
  return (
    <span
      className={`avatar ${pokemon ? 'is-pokemon' : 'is-photo'} ${className}`}
      style={{ width: size, height: size }}
      title={avatar.name}
    >
      <img src={avatarImage(avatar.id, large ? 'md' : 'sm')} alt="" draggable={false} />
    </span>
  )
}
