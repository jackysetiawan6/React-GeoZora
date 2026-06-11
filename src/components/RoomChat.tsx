import ChatPanel from "./match/ChatPanel";
import { type MatchRoom } from "../lib/Matchmaking";

interface RoomChatProps {
	room: MatchRoom;
	isHost: boolean;
}

export default function RoomChat({ room, isHost }: RoomChatProps) {
	return <ChatPanel room={room} isHost={isHost} variant="embedded" />;
}
