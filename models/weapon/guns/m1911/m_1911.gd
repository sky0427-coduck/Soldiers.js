extends MeshInstance3D

# 발사체(총알) 생성 공통 리소스
const BULLET_SCENE : PackedScene = preload("res://model/items/bullet_45/BulletProjectile.tscn")

# 탄약 설정
var max_ammo : int = 7
var current_ammo : int = 7
var is_firing : bool = false # 연사 방지용 변수

# 공격력
@export var damage : int = 6

# 부모 노드가 Camera3D입니다. (world.tscn: Player/Camera3D/M1911)
@onready var camera : Camera3D = get_parent() as Camera3D

# 화면 UI 텍스트(Label) 노드를 찾아옵니다. (m1911 폴더 깊이에 맞춘 경로)
@onready var ammo_label : Label = $"../../../CanvasLayer/Label"

# WeaponManager가 무기 교체(1, 2번 키) 시 이 값을 통해 현재 활성 무기인지 확인합니다.
var is_active : bool = true

# [추가] 게임이 켜질 때 화면 UI에 처음 탄약 숫자를 띄웁니다.
func _ready():
	update_ammo_label()


func update_ammo_label():
	if ammo_label and is_active:
		ammo_label.text = "AMMO: " + str(current_ammo) + " / " + str(max_ammo)


# WeaponManager가 무기 전환 시 호출합니다.
func set_active(active: bool) -> void:
	is_active = active
	visible = active
	set_process_unhandled_input(active)
	if active:
		update_ammo_label()


func reload_weapon():
	print("재장전 중..")
	current_ammo = max_ammo 
	update_ammo_label()

func _unhandled_input(event):
	# "fire" 대신 설정하신 이름인 "HandGunFire"로 매칭해 줍니다.
	if event.is_action_pressed("HandGunFire") and not is_firing:
		fire_weapon()
	if event.is_action_pressed("gun_reload") and not is_firing:
		reload_weapon()


func fire_weapon():
	if current_ammo > 0:
		current_ammo -= 1
		print("탕! 남은 탄약: ", current_ammo, " / ", max_ammo)
		update_ammo_label()

		_spawn_bullet()

		# 발사 모션(반동) 실행
		play_recoil()
	else:
		print("총알이 없습니다. 재장전이 필요합니다.")


func _spawn_bullet() -> void:
	if BULLET_SCENE == null or camera == null:
		return

	var bullet := BULLET_SCENE.instantiate()
	get_tree().current_scene.add_child(bullet)
	bullet.global_transform = camera.global_transform
	# 카메라 위치에서 약간 앞으로 띄워서 총구에서 나가는 느낌을 냅니다.
	bullet.global_position += -camera.global_transform.basis.z * 0.5
	bullet.damage = damage

	var shooter := camera.get_parent()
	if shooter is CollisionObject3D:
		bullet.shooter_rid = (shooter as CollisionObject3D).get_rid()

func play_recoil():
	is_firing = true
	var tween = create_tween().set_parallel(true) # 동시에 여러 움직임 실행
	
	# --- [1단계: 발사! 순간적으로 뒤로 밀리고 위로 들림 (0.04초)] ---
	# 뒤로 후퇴 (카메라 시선 기준 앞뒤 조절)
	tween.tween_property(self, "position:z", position.z + 0.12, 0.04)
	# 살짝 위로 들림
	tween.tween_property(self, "position:y", position.y + 0.05, 0.04)
	# 총구 회전 (앞부분이 위로 들리는 회전)
	tween.tween_property(self, "rotation_degrees:x", rotation_degrees.x - 10.0, 0.04)
	
	# --- [2단계: 복귀! 원래 자리로 천천히 돌아옴 (0.12초)] ---
	# 편의를 위해 복귀 트윈을 새로 하나 만듭니다
	var return_tween = create_tween().set_parallel(true)
	return_tween.set_trans(Tween.TRANS_SINE) # 부드러운 움직임 효과
	
	return_tween.tween_property(self, "position:z", position.z, 0.12).set_delay(0.04)
	return_tween.tween_property(self, "position:y", position.y, 0.12).set_delay(0.04)
	return_tween.tween_property(self, "rotation_degrees:x", rotation_degrees.x, 0.12).set_delay(0.04)
	
	# 모든 반동 동작이 끝나면 연사 잠금 해제
	return_tween.finished.connect(func(): is_firing = false)
